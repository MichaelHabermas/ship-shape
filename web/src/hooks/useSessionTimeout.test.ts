import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSessionTimeout } from './useSessionTimeout';
import * as api from '@/lib/api';
import { clearCsrfToken } from '@/lib/api';

/**
 * Unit Tests for useSessionTimeout Hook
 *
 * These tests verify the core timing and state logic of the session timeout hook.
 * They use fake timers to test time-sensitive behavior without waiting.
 */

// Time constants from the hook (in ms)
const SESSION_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes
const WARNING_THRESHOLD_MS = 60 * 1000; // 1 minute before timeout
const TIME_UNTIL_WARNING = SESSION_TIMEOUT_MS - WARNING_THRESHOLD_MS; // 14 minutes
const ABSOLUTE_SESSION_TIMEOUT_MS = 12 * 60 * 60 * 1000; // 12 hours
const ABSOLUTE_WARNING_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes before absolute timeout
const ACTIVITY_THROTTLE_MS = 30 * 1000; // 30 seconds

// Mock fetch globally
const mockFetch = vi.fn();

function jsonResponse(body: object, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function sessionInfo(overrides: Partial<{ createdAt: string; expiresAt: string; lastActivity: string }> = {}) {
  return {
    success: true,
    data: {
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + SESSION_TIMEOUT_MS).toISOString(),
      lastActivity: new Date().toISOString(),
      ...overrides,
    },
  };
}

function mockSuccessfulSessionFetch(overrides?: Partial<{ createdAt: string; expiresAt: string; lastActivity: string }>) {
  mockFetch.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();

    if (url.endsWith('/api/auth/session')) {
      expect(init).toEqual({ credentials: 'include' });
      return jsonResponse(sessionInfo(overrides));
    }

    if (url.endsWith('/api/csrf-token')) {
      expect(init).toEqual({ credentials: 'include' });
      return jsonResponse({ token: 'test-csrf-token' });
    }

    if (url.endsWith('/api/auth/extend-session')) {
      expect(init).toMatchObject({
        method: 'POST',
        credentials: 'include',
        headers: expect.objectContaining({
          'X-CSRF-Token': 'test-csrf-token',
        }) as unknown,
      });
      return jsonResponse({ success: true });
    }

    throw new Error(`Unexpected fetch: ${url}`);
  });
}

describe('useSessionTimeout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Reset fetch mock
    mockFetch.mockReset();
    clearCsrfToken();
    mockSuccessfulSessionFetch();
    global.fetch = mockFetch;
    vi.spyOn(api, 'apiPost').mockResolvedValue(jsonResponse({ success: true }));
    // Mock document event listeners
    vi.spyOn(document, 'addEventListener');
    vi.spyOn(document, 'removeEventListener');
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('Initial State', () => {
    it('starts with showWarning = false', () => {
      const onTimeout = vi.fn();
      const { result } = renderHook(() => useSessionTimeout(onTimeout));

      expect(result.current.showWarning).toBe(false);
    });

    it('starts with timeRemaining = null when not warning', () => {
      const onTimeout = vi.fn();
      const { result } = renderHook(() => useSessionTimeout(onTimeout));

      expect(result.current.timeRemaining).toBeNull();
    });

    it('starts tracking from current time on mount', () => {
      const now = Date.now();
      const onTimeout = vi.fn();
      const { result } = renderHook(() => useSessionTimeout(onTimeout));

      // lastActivity should be within a small margin of now
      expect(result.current.lastActivity).toBeGreaterThanOrEqual(now);
      expect(result.current.lastActivity).toBeLessThanOrEqual(now + 100);
    });
  });

  describe('Inactivity Timer', () => {
    it('shows warning after 14 minutes of inactivity', async () => {
      const onTimeout = vi.fn();
      const { result } = renderHook(() => useSessionTimeout(onTimeout));

      // Advance 14 minutes (time until warning)
      await act(async () => {
        vi.advanceTimersByTime(TIME_UNTIL_WARNING);
      });

      expect(result.current.showWarning).toBe(true);
      expect(result.current.warningType).toBe('inactivity');
    });

    it('does NOT show warning before 14 minutes', async () => {
      const onTimeout = vi.fn();
      const { result } = renderHook(() => useSessionTimeout(onTimeout));

      // Advance 13 minutes 59 seconds
      await act(async () => {
        vi.advanceTimersByTime(TIME_UNTIL_WARNING - 1000);
      });

      expect(result.current.showWarning).toBe(false);
    });

    it('sets timeRemaining to 60 when warning appears', async () => {
      const onTimeout = vi.fn();
      const { result } = renderHook(() => useSessionTimeout(onTimeout));

      await act(async () => {
        vi.advanceTimersByTime(TIME_UNTIL_WARNING);
      });

      expect(result.current.showWarning).toBe(true);
      expect(result.current.timeRemaining).toBe(60);
    });

    it('decrements timeRemaining every second during warning', async () => {
      const onTimeout = vi.fn();
      const { result } = renderHook(() => useSessionTimeout(onTimeout));

      // Advance to warning
      await act(async () => {
        vi.advanceTimersByTime(TIME_UNTIL_WARNING);
      });

      expect(result.current.timeRemaining).toBe(60);

      // Advance 5 more seconds
      await act(async () => {
        vi.advanceTimersByTime(5000);
      });

      expect(result.current.timeRemaining).toBe(55);
    });

    it('calls onTimeout when timeRemaining reaches 0', async () => {
      const onTimeout = vi.fn();
      renderHook(() => useSessionTimeout(onTimeout));

      // Advance to warning (14 min) + full countdown (60 sec)
      await act(async () => {
        vi.advanceTimersByTime(TIME_UNTIL_WARNING + WARNING_THRESHOLD_MS);
      });

      expect(onTimeout).toHaveBeenCalledTimes(1);
    });

    it('does NOT call onTimeout if dismissed before 0', async () => {
      const onTimeout = vi.fn();
      const { result } = renderHook(() => useSessionTimeout(onTimeout));

      // Advance to warning
      await act(async () => {
        vi.advanceTimersByTime(TIME_UNTIL_WARNING);
      });

      expect(result.current.showWarning).toBe(true);

      // Dismiss warning by calling resetTimer
      await act(async () => {
        await result.current.resetTimer();
      });

      // Advance past what would have been the timeout
      await act(async () => {
        vi.advanceTimersByTime(WARNING_THRESHOLD_MS);
      });

      expect(onTimeout).not.toHaveBeenCalled();
    });
  });

  describe('Activity Reset', () => {
    it('resetTimer() hides warning modal', async () => {
      const onTimeout = vi.fn();
      const { result } = renderHook(() => useSessionTimeout(onTimeout));

      // Advance to show warning
      await act(async () => {
        vi.advanceTimersByTime(TIME_UNTIL_WARNING);
      });

      expect(result.current.showWarning).toBe(true);

      // Reset timer
      await act(async () => {
        await result.current.resetTimer();
      });

      expect(result.current.showWarning).toBe(false);
    });

    it('resetTimer() resets lastActivity to now', async () => {
      const onTimeout = vi.fn();
      const { result } = renderHook(() => useSessionTimeout(onTimeout));
      const initialActivity = result.current.lastActivity;

      // Advance some time
      await act(async () => {
        vi.advanceTimersByTime(5 * 60 * 1000); // 5 minutes
      });

      // Call resetTimer
      await act(async () => {
        await result.current.resetTimer();
      });

      expect(result.current.lastActivity).toBeGreaterThan(initialActivity);
    });

    it('after resetTimer(), warning appears 14 min later (not sooner)', async () => {
      const onTimeout = vi.fn();
      const { result } = renderHook(() => useSessionTimeout(onTimeout));

      // Advance 10 minutes
      await act(async () => {
        vi.advanceTimersByTime(10 * 60 * 1000);
      });

      expect(result.current.showWarning).toBe(false);

      // Reset the timer
      await act(async () => {
        await result.current.resetTimer();
      });

      // Advance 10 more minutes (would be 20 min total, but only 10 from reset)
      await act(async () => {
        vi.advanceTimersByTime(10 * 60 * 1000);
      });

      // Should NOT show warning yet (only 10 min from reset, need 14)
      expect(result.current.showWarning).toBe(false);

      // Advance 4 more minutes (14 total from reset)
      await act(async () => {
        vi.advanceTimersByTime(4 * 60 * 1000);
      });

      expect(result.current.showWarning).toBe(true);
    });

    it('resetTimer() clears countdown interval', async () => {
      const onTimeout = vi.fn();
      const { result } = renderHook(() => useSessionTimeout(onTimeout));

      // Advance to show warning
      await act(async () => {
        vi.advanceTimersByTime(TIME_UNTIL_WARNING);
      });

      expect(result.current.timeRemaining).toBe(60);

      // Advance a bit to start countdown
      await act(async () => {
        vi.advanceTimersByTime(5000);
      });

      expect(result.current.timeRemaining).toBe(55);

      // Reset timer
      await act(async () => {
        await result.current.resetTimer();
      });

      // timeRemaining should be null
      expect(result.current.timeRemaining).toBeNull();
    });
  });

  describe('Absolute Timeout', () => {
    it('shows absolute warning at 11:55 from session start', async () => {
      const sessionCreatedAt = new Date().toISOString();
      mockSuccessfulSessionFetch({ createdAt: sessionCreatedAt });

      const onTimeout = vi.fn();
      const { result } = renderHook(() => useSessionTimeout(onTimeout));

      // Let fetch resolve
      await act(async () => {
        await Promise.resolve();
      });

      // Advance to 11:55 (absolute warning time)
      const timeToAbsoluteWarning = ABSOLUTE_SESSION_TIMEOUT_MS - ABSOLUTE_WARNING_THRESHOLD_MS;
      await act(async () => {
        vi.advanceTimersByTime(timeToAbsoluteWarning);
      });

      expect(result.current.showWarning).toBe(true);
      expect(result.current.warningType).toBe('absolute');
    });

    it('absolute warning has 5-minute countdown', async () => {
      const sessionCreatedAt = new Date().toISOString();
      mockSuccessfulSessionFetch({ createdAt: sessionCreatedAt });

      const onTimeout = vi.fn();
      const { result } = renderHook(() => useSessionTimeout(onTimeout));

      await act(async () => {
        await Promise.resolve();
      });

      // Advance to absolute warning (11:55)
      const timeToAbsoluteWarning = ABSOLUTE_SESSION_TIMEOUT_MS - ABSOLUTE_WARNING_THRESHOLD_MS;
      await act(async () => {
        vi.advanceTimersByTime(timeToAbsoluteWarning);
      });

      expect(result.current.timeRemaining).toBe(300); // 5 minutes in seconds
    });

    it('activity does NOT reset absolute timeout', async () => {
      const sessionCreatedAt = new Date().toISOString();
      mockSuccessfulSessionFetch({ createdAt: sessionCreatedAt });

      const onTimeout = vi.fn();
      const { result } = renderHook(() => useSessionTimeout(onTimeout));

      await act(async () => {
        await Promise.resolve();
      });

      // Advance to 11:50
      await act(async () => {
        vi.advanceTimersByTime(ABSOLUTE_SESSION_TIMEOUT_MS - ABSOLUTE_WARNING_THRESHOLD_MS - 5 * 60 * 1000);
      });

      // Reset activity (inactivity timer)
      await act(async () => {
        await result.current.resetTimer();
      });

      // Advance 5 more minutes to reach 11:55
      await act(async () => {
        vi.advanceTimersByTime(5 * 60 * 1000);
      });

      // Absolute warning should still appear (resetTimer doesn't affect absolute timeout)
      expect(result.current.showWarning).toBe(true);
      expect(result.current.warningType).toBe('absolute');
    });

    it('absolute timeout fires at 12 hours regardless of activity', async () => {
      // Session created 11:55 ago - just past absolute warning point
      // Absolute warning would have started, and countdown at 300 seconds
      const almostTwelveHoursAgo = new Date(
        Date.now() - (ABSOLUTE_SESSION_TIMEOUT_MS - ABSOLUTE_WARNING_THRESHOLD_MS)
      ).toISOString();
      mockSuccessfulSessionFetch({ createdAt: almostTwelveHoursAgo });

      const onTimeout = vi.fn();
      renderHook(() => useSessionTimeout(onTimeout));

      await act(async () => {
        await Promise.resolve();
      });

      // Absolute warning should show immediately (since session is 11:55 old)
      // Advance through the 5-minute countdown
      await act(async () => {
        vi.advanceTimersByTime(ABSOLUTE_WARNING_THRESHOLD_MS + 1000);
      });

      // onTimeout should have been called due to absolute timeout
      expect(onTimeout).toHaveBeenCalled();
    });
  });

  describe('Warning Type', () => {
    it('inactivity warning has type = "inactivity"', async () => {
      const onTimeout = vi.fn();
      const { result } = renderHook(() => useSessionTimeout(onTimeout));

      await act(async () => {
        vi.advanceTimersByTime(TIME_UNTIL_WARNING);
      });

      expect(result.current.warningType).toBe('inactivity');
    });

    it('absolute warning has type = "absolute"', async () => {
      // Session created 11:54 ago - just before absolute warning point
      // This way when we advance 1 minute, absolute warning fires
      const almostAtAbsoluteWarning = new Date(
        Date.now() - (ABSOLUTE_SESSION_TIMEOUT_MS - ABSOLUTE_WARNING_THRESHOLD_MS - 60 * 1000)
      ).toISOString();
      mockSuccessfulSessionFetch({ createdAt: almostAtAbsoluteWarning });

      const onTimeout = vi.fn();
      const { result } = renderHook(() => useSessionTimeout(onTimeout));

      await act(async () => {
        await Promise.resolve();
      });

      // Advance 1 minute - absolute warning should appear
      // Note: inactivity warning would fire at 14 min, but we're only advancing 1 min
      await act(async () => {
        vi.advanceTimersByTime(60 * 1000);
      });

      expect(result.current.showWarning).toBe(true);
      expect(result.current.warningType).toBe('absolute');
    });

    it('inactivity warning takes precedence if both imminent', async () => {
      // Session created 11:50 ago - both warnings would trigger soon
      const sessionCreatedAt = new Date(Date.now() - (ABSOLUTE_SESSION_TIMEOUT_MS - 10 * 60 * 1000)).toISOString();
      mockSuccessfulSessionFetch({ createdAt: sessionCreatedAt });

      const onTimeout = vi.fn();
      const { result } = renderHook(() => useSessionTimeout(onTimeout));

      await act(async () => {
        await Promise.resolve();
      });

      // Advance 14 minutes - inactivity warning should fire first
      await act(async () => {
        vi.advanceTimersByTime(TIME_UNTIL_WARNING);
      });

      expect(result.current.showWarning).toBe(true);
      expect(result.current.warningType).toBe('inactivity');
    });
  });

  describe('Event Listeners', () => {
    it('registers activity listeners on mount', () => {
      const onTimeout = vi.fn();
      renderHook(() => useSessionTimeout(onTimeout));

      // Check that addEventListener was called for activity events
      expect(document.addEventListener).toHaveBeenCalledWith(
        'mousedown',
        expect.any(Function),
        expect.objectContaining({ passive: true, capture: true })
      );
      expect(document.addEventListener).toHaveBeenCalledWith(
        'keydown',
        expect.any(Function),
        expect.objectContaining({ passive: true, capture: true })
      );
      expect(document.addEventListener).toHaveBeenCalledWith(
        'scroll',
        expect.any(Function),
        expect.objectContaining({ passive: true, capture: true })
      );
    });

    it('removes activity listeners on unmount', () => {
      const onTimeout = vi.fn();
      const { unmount } = renderHook(() => useSessionTimeout(onTimeout));

      unmount();

      expect(document.removeEventListener).toHaveBeenCalledWith(
        'mousedown',
        expect.any(Function),
        expect.objectContaining({ capture: true })
      );
      expect(document.removeEventListener).toHaveBeenCalledWith(
        'keydown',
        expect.any(Function),
        expect.objectContaining({ capture: true })
      );
    });

    it('activity listener resets timer (throttled)', async () => {
      const onTimeout = vi.fn();
      const { result } = renderHook(() => useSessionTimeout(onTimeout));

      const initialActivity = result.current.lastActivity;

      // Advance past throttle period
      await act(async () => {
        vi.advanceTimersByTime(ACTIVITY_THROTTLE_MS + 1000);
      });

      // Simulate mousedown event
      await act(async () => {
        const event = new MouseEvent('mousedown');
        document.dispatchEvent(event);
      });

      // lastActivity should have been updated
      expect(result.current.lastActivity).toBeGreaterThan(initialActivity);
    });

    it('activity events are throttled to max once per 30 seconds', async () => {
      const onTimeout = vi.fn();
      const { result } = renderHook(() => useSessionTimeout(onTimeout));

      // Advance past initial throttle
      await act(async () => {
        vi.advanceTimersByTime(ACTIVITY_THROTTLE_MS + 1000);
      });

      // Fire first event
      await act(async () => {
        document.dispatchEvent(new MouseEvent('mousedown'));
      });

      const activityAfterFirst = result.current.lastActivity;

      // Fire many more events rapidly (within throttle window)
      for (let i = 0; i < 100; i++) {
        await act(async () => {
          document.dispatchEvent(new MouseEvent('mousedown'));
        });
      }

      // Activity should not have changed (within throttle period)
      expect(result.current.lastActivity).toBe(activityAfterFirst);

      // Now advance past throttle period
      await act(async () => {
        vi.advanceTimersByTime(ACTIVITY_THROTTLE_MS + 1000);
      });

      // Fire another event
      await act(async () => {
        document.dispatchEvent(new MouseEvent('mousedown'));
      });

      // Now it should have updated
      expect(result.current.lastActivity).toBeGreaterThan(activityAfterFirst);
    });
  });

  describe('Cleanup', () => {
    it('clears all timers on unmount', async () => {
      const onTimeout = vi.fn();
      const { unmount } = renderHook(() => useSessionTimeout(onTimeout));

      // Advance to show warning
      await act(async () => {
        vi.advanceTimersByTime(TIME_UNTIL_WARNING);
      });

      // Unmount the hook
      unmount();

      // Advance more time - onTimeout should NOT be called since we unmounted
      await act(async () => {
        vi.advanceTimersByTime(WARNING_THRESHOLD_MS);
      });

      expect(onTimeout).not.toHaveBeenCalled();
    });

    it('clears interval when warning dismissed', async () => {
      const onTimeout = vi.fn();
      const { result } = renderHook(() => useSessionTimeout(onTimeout));

      // Advance to show warning
      await act(async () => {
        vi.advanceTimersByTime(TIME_UNTIL_WARNING);
      });

      expect(result.current.timeRemaining).toBe(60);

      // Dismiss the warning
      await act(async () => {
        await result.current.resetTimer();
      });

      // Verify countdown stopped
      expect(result.current.timeRemaining).toBeNull();
    });
  });

  describe('Session Info Integration', () => {
    it('fetches session info on mount', async () => {
      const onTimeout = vi.fn();
      renderHook(() => useSessionTimeout(onTimeout));

      // Let the effect run
      await act(async () => {
        await Promise.resolve();
      });

      expect(mockFetch).toHaveBeenCalledWith('/api/auth/session', {
        credentials: 'include',
      });
    });

    it('uses server createdAt for absolute timeout calculation', async () => {
      // Session was created 11:54 ago on the server
      // Even though this hook just mounted, absolute warning should fire in ~1 min
      const elevenFiftyFourAgo = new Date(
        Date.now() - (ABSOLUTE_SESSION_TIMEOUT_MS - ABSOLUTE_WARNING_THRESHOLD_MS - 60 * 1000)
      ).toISOString();
      mockSuccessfulSessionFetch({ createdAt: elevenFiftyFourAgo });

      const onTimeout = vi.fn();
      const { result } = renderHook(() => useSessionTimeout(onTimeout));

      await act(async () => {
        await Promise.resolve();
      });

      // Advance 1 minute - absolute warning should appear based on server createdAt
      await act(async () => {
        vi.advanceTimersByTime(60 * 1000);
      });

      expect(result.current.showWarning).toBe(true);
      expect(result.current.warningType).toBe('absolute');
    });

    it('handles session info fetch failure gracefully', async () => {
      // Make fetch fail
      mockFetch.mockRejectedValue(new Error('Network error'));

      const onTimeout = vi.fn();
      const { result } = renderHook(() => useSessionTimeout(onTimeout));

      await act(async () => {
        await Promise.resolve();
      });

      // Hook should still work - inactivity timeout should still function
      await act(async () => {
        vi.advanceTimersByTime(TIME_UNTIL_WARNING);
      });

      expect(result.current.showWarning).toBe(true);
      expect(result.current.warningType).toBe('inactivity');
    });
  });
});

describe('useSessionTimeout - Edge Cases', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockFetch.mockReset();
    clearCsrfToken();
    mockSuccessfulSessionFetch();
    global.fetch = mockFetch;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('handles time jump (computer wake from sleep)', async () => {
    const onTimeout = vi.fn();
    renderHook(() => useSessionTimeout(onTimeout));

    // Simulate visibility change after a long sleep (20 minutes)
    await act(async () => {
      vi.advanceTimersByTime(20 * 60 * 1000);
    });

    // Trigger visibility change (simulating wake from sleep)
    await act(async () => {
      Object.defineProperty(document, 'visibilityState', {
        value: 'visible',
        writable: true,
      });
      document.dispatchEvent(new Event('visibilitychange'));
    });

    // onTimeout should have been called because we jumped past the timeout
    expect(onTimeout).toHaveBeenCalled();
  });

  it('handles rapid mount/unmount without errors', async () => {
    const onTimeout = vi.fn();

    // Mount and unmount rapidly
    for (let i = 0; i < 10; i++) {
      const { unmount } = renderHook(() => useSessionTimeout(onTimeout));
      await act(async () => {
        vi.advanceTimersByTime(100);
      });
      unmount();
    }

    // No errors should have been thrown
    expect(true).toBe(true);
  });

  it('handles resetTimer called when not showing warning', async () => {
    const onTimeout = vi.fn();
    mockSuccessfulSessionFetch();

    const { result } = renderHook(() => useSessionTimeout(onTimeout));

    // Call resetTimer before any warning
    await act(async () => {
      await result.current.resetTimer();
    });

    // Should not throw and hook should still work
    expect(result.current.showWarning).toBe(false);
    expect(result.current.timeRemaining).toBeNull();
  });

  it('handles multiple resetTimer calls in quick succession', async () => {
    const onTimeout = vi.fn();
    mockSuccessfulSessionFetch();

    const { result } = renderHook(() => useSessionTimeout(onTimeout));

    // Show warning
    await act(async () => {
      vi.advanceTimersByTime(TIME_UNTIL_WARNING);
    });

    expect(result.current.showWarning).toBe(true);

    // Call resetTimer multiple times rapidly
    await act(async () => {
      // First call will succeed, others should be blocked by extendingSessionRef guard
      result.current.resetTimer();
      result.current.resetTimer();
      result.current.resetTimer();
      await Promise.resolve();
    });

    // Should work correctly without errors
    expect(result.current.showWarning).toBe(false);
  });

  it('survives component re-render without resetting timer', async () => {
    const onTimeout = vi.fn();
    const { result, rerender } = renderHook(() => useSessionTimeout(onTimeout));

    const initialActivity = result.current.lastActivity;

    // Advance some time
    await act(async () => {
      vi.advanceTimersByTime(5 * 60 * 1000);
    });

    // Re-render the hook (simulates parent re-render)
    rerender();

    // lastActivity should NOT have changed
    expect(result.current.lastActivity).toBe(initialActivity);
  });
});
