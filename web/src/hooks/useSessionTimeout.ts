import { useState, useEffect, useCallback, useRef } from 'react';
import { SESSION_TIMEOUT_MS, ABSOLUTE_SESSION_TIMEOUT_MS } from '@ship/shared';
import { apiPost } from '@/lib/api';

// Warning appears 60 seconds before timeout
const WARNING_THRESHOLD_MS = 60 * 1000;
// Absolute timeout warning appears 5 minutes before
const ABSOLUTE_WARNING_THRESHOLD_MS = 5 * 60 * 1000;
// Throttle activity events to once per 30 seconds
const ACTIVITY_THROTTLE_MS = 30 * 1000;

export type WarningType = 'inactivity' | 'absolute';

export interface SessionTimeoutState {
  showWarning: boolean;
  timeRemaining: number | null;
  warningType: WarningType | null;
  resetTimer: () => void;
  lastActivity: number;
}

interface SessionInfo {
  createdAt: string;
  expiresAt: string;
  lastActivity: string;
}

export function useSessionTimeout(onTimeout: () => void): SessionTimeoutState {
  const [showWarning, setShowWarning] = useState(false);
  const [timeRemaining, setTimeRemaining] = useState<number | null>(null);
  const [warningType, setWarningType] = useState<WarningType | null>(null);
  const [lastActivity, setLastActivity] = useState(() => Date.now());
  const [sessionCreatedAt, setSessionCreatedAt] = useState<number | null>(null);

  const lastActivityRef = useRef(lastActivity);
  const lastThrottledActivityRef = useRef(Date.now());
  const warningTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const absoluteWarningTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onTimeoutRef = useRef(onTimeout);
  // Ref to break circular dependency between resetTimer and scheduleInactivityWarning
  const scheduleInactivityWarningRef = useRef<() => void>(() => {});
  // Guard to prevent duplicate extend-session API calls
  const extendingSessionRef = useRef(false);

  // Keep onTimeout ref updated
  useEffect(() => {
    onTimeoutRef.current = onTimeout;
  }, [onTimeout]);

  // Fetch session info on mount
  useEffect(() => {
    async function fetchSessionInfo() {
      try {
        const response = await fetch('/api/auth/session', {
          credentials: 'include',
        });
        if (response.ok) {
          const data = await response.json();
          if (data.success && data.data) {
            const info: SessionInfo = data.data;
            setSessionCreatedAt(new Date(info.createdAt).getTime());
          }
        }
      } catch {
        // Ignore errors - absolute timeout tracking won't work but inactivity still will
      }
    }
    fetchSessionInfo();
  }, []);

  // Clear all timers helper
  const clearAllTimers = useCallback(() => {
    if (warningTimerRef.current) {
      clearTimeout(warningTimerRef.current);
      warningTimerRef.current = null;
    }
    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current);
      countdownIntervalRef.current = null;
    }
    if (absoluteWarningTimerRef.current) {
      clearTimeout(absoluteWarningTimerRef.current);
      absoluteWarningTimerRef.current = null;
    }
  }, []);

  // Reset timer - dismisses warning, resets inactivity tracking, and schedules next warning
  // Also calls the extend-session API to extend the server-side session
  const resetTimer = useCallback(async () => {
    // Prevent duplicate API calls
    if (extendingSessionRef.current) {
      return;
    }
    extendingSessionRef.current = true;

    const now = Date.now();
    setLastActivity(now);
    lastActivityRef.current = now;
    setShowWarning(false);
    setTimeRemaining(null);
    setWarningType(null);
    clearAllTimers();
    // Schedule the next inactivity warning
    scheduleInactivityWarningRef.current();

    // Call extend-session API to extend server-side session
    try {
      const response = await apiPost('/api/auth/extend-session');
      if (!response.ok) {
        // API call failed - force logout
        console.error('Failed to extend session - forcing logout');
        onTimeoutRef.current();
      }
    } catch {
      // Network error - force logout
      console.error('Network error extending session - forcing logout');
      onTimeoutRef.current();
    } finally {
      extendingSessionRef.current = false;
    }
  }, [clearAllTimers]);

  // Schedule inactivity warning
  const scheduleInactivityWarning = useCallback(() => {
    if (warningTimerRef.current) {
      clearTimeout(warningTimerRef.current);
    }

    const timeUntilWarning = SESSION_TIMEOUT_MS - WARNING_THRESHOLD_MS;

    warningTimerRef.current = setTimeout(() => {
      // Check if we've had activity since scheduling
      const now = Date.now();
      const timeSinceActivity = now - lastActivityRef.current;

      if (timeSinceActivity >= timeUntilWarning) {
        // Show inactivity warning
        setShowWarning(true);
        setTimeRemaining(60);
        setWarningType('inactivity');

        // Start countdown
	        countdownIntervalRef.current = setInterval(() => {
	          setTimeRemaining((prev) => {
	            if (prev === null || prev <= 1) {
	              if (countdownIntervalRef.current) {
	                clearInterval(countdownIntervalRef.current);
	              }
	              countdownIntervalRef.current = null;
	              onTimeoutRef.current();
	              return 0;
	            }
            return prev - 1;
          });
        }, 1000);
      } else {
        // Re-schedule based on actual last activity
        scheduleInactivityWarning();
      }
    }, timeUntilWarning);
  }, []);

  // Keep the ref updated for resetTimer to use
  scheduleInactivityWarningRef.current = scheduleInactivityWarning;

  // Schedule absolute timeout warning
  const scheduleAbsoluteWarning = useCallback(() => {
    if (!sessionCreatedAt) return;

    if (absoluteWarningTimerRef.current) {
      clearTimeout(absoluteWarningTimerRef.current);
    }

    const now = Date.now();
    const sessionAge = now - sessionCreatedAt;
    const timeUntilAbsoluteWarning = ABSOLUTE_SESSION_TIMEOUT_MS - ABSOLUTE_WARNING_THRESHOLD_MS - sessionAge;

    if (timeUntilAbsoluteWarning <= 0) {
      // Already past warning time - show immediately if not already showing inactivity warning
      if (!showWarning || warningType !== 'inactivity') {
        setShowWarning(true);
        setTimeRemaining(300); // 5 minutes
        setWarningType('absolute');

        // Start countdown for absolute timeout
        if (countdownIntervalRef.current) {
          clearInterval(countdownIntervalRef.current);
        }
	        countdownIntervalRef.current = setInterval(() => {
	          setTimeRemaining((prev) => {
	            if (prev === null || prev <= 1) {
	              if (countdownIntervalRef.current) {
	                clearInterval(countdownIntervalRef.current);
	              }
	              countdownIntervalRef.current = null;
	              onTimeoutRef.current();
	              return 0;
	            }
            return prev - 1;
          });
        }, 1000);
      }
      return;
    }

    absoluteWarningTimerRef.current = setTimeout(() => {
      // Only show absolute warning if we're not already showing inactivity warning
      // Inactivity warning takes precedence
      if (!showWarning) {
        setShowWarning(true);
        setTimeRemaining(300); // 5 minutes
        setWarningType('absolute');

        // Start countdown
	        countdownIntervalRef.current = setInterval(() => {
	          setTimeRemaining((prev) => {
	            if (prev === null || prev <= 1) {
	              if (countdownIntervalRef.current) {
	                clearInterval(countdownIntervalRef.current);
	              }
	              countdownIntervalRef.current = null;
	              onTimeoutRef.current();
	              return 0;
	            }
            return prev - 1;
          });
        }, 1000);
      }
    }, timeUntilAbsoluteWarning);
  }, [sessionCreatedAt, showWarning, warningType]);

  // Handle activity events (throttled)
  const handleActivity = useCallback(() => {
    const now = Date.now();

    // Throttle activity updates
    if (now - lastThrottledActivityRef.current < ACTIVITY_THROTTLE_MS) {
      return;
    }

    lastThrottledActivityRef.current = now;

    // If showing inactivity warning, dismiss it and reset timer
    // Note: resetTimer() now automatically schedules the next warning
    if (showWarning && warningType === 'inactivity') {
      resetTimer();
    } else if (!showWarning) {
      // Just update last activity
      setLastActivity(now);
      lastActivityRef.current = now;
    }
    // Don't reset for absolute warning - it can't be extended
  }, [showWarning, warningType, resetTimer]);

  // Set up activity listeners
  useEffect(() => {
    const events = ['mousedown', 'keydown', 'scroll', 'touchstart', 'mousemove'];

    events.forEach((event) => {
      document.addEventListener(event, handleActivity, { passive: true, capture: true });
    });

    return () => {
      events.forEach((event) => {
        document.removeEventListener(event, handleActivity, { capture: true });
      });
    };
  }, [handleActivity]);

  // Schedule warnings on mount and when dependencies change
  useEffect(() => {
    scheduleInactivityWarning();
    return () => {
      if (warningTimerRef.current) {
        clearTimeout(warningTimerRef.current);
      }
    };
  }, [scheduleInactivityWarning]);

  useEffect(() => {
    scheduleAbsoluteWarning();
    return () => {
      if (absoluteWarningTimerRef.current) {
        clearTimeout(absoluteWarningTimerRef.current);
      }
    };
  }, [scheduleAbsoluteWarning]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      clearAllTimers();
    };
  }, [clearAllTimers]);

  // Handle computer sleep/wake - check if we've jumped past timeout
  useEffect(() => {
    const checkForTimeJump = () => {
      const now = Date.now();
      const timeSinceActivity = now - lastActivityRef.current;

      // If we've jumped past the full timeout, trigger immediately
      if (timeSinceActivity >= SESSION_TIMEOUT_MS) {
        onTimeoutRef.current();
      }

      // Also check absolute timeout
      if (sessionCreatedAt) {
        const sessionAge = now - sessionCreatedAt;
        if (sessionAge >= ABSOLUTE_SESSION_TIMEOUT_MS) {
          onTimeoutRef.current();
        }
      }
    };

    // Check on visibility change (tab becomes visible after being hidden)
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        checkForTimeJump();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [sessionCreatedAt]);

  return {
    showWarning,
    timeRemaining,
    warningType,
    resetTimer,
    lastActivity,
  };
}
