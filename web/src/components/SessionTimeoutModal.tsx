import { useEffect, useRef, useState, useCallback } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import type { WarningType } from '@/hooks/useSessionTimeout';

interface SessionTimeoutModalProps {
  open: boolean;
  timeRemaining: number | null;
  warningType: WarningType | null;
  onStayLoggedIn: () => void;
}

// Announcements happen at these seconds remaining
const ANNOUNCEMENT_THRESHOLDS = [30, 20, 10, 5];

export function SessionTimeoutModal({
  open,
  timeRemaining,
  warningType,
  onStayLoggedIn,
}: SessionTimeoutModalProps) {
  const stayLoggedInButtonRef = useRef<HTMLButtonElement>(null);
  const [lastAnnouncement, setLastAnnouncement] = useState<number | null>(null);
  const announcementRef = useRef<HTMLDivElement>(null);

  // Format time as M:SS
  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Focus the Stay Logged In button when modal opens
  useEffect(() => {
    if (open && stayLoggedInButtonRef.current) {
      // Delay to ensure the modal is fully mounted
      const timer = setTimeout(() => {
        stayLoggedInButtonRef.current?.focus();
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [open]);

  // Screen reader announcements at key intervals
  useEffect(() => {
    if (!open || timeRemaining === null) return;

    // Check if we should announce
    if (
      ANNOUNCEMENT_THRESHOLDS.includes(timeRemaining) &&
      timeRemaining !== lastAnnouncement
    ) {
      setLastAnnouncement(timeRemaining);
      // The aria-live region will automatically announce
    }
  }, [open, timeRemaining, lastAnnouncement]);

  // Reset announcement tracking when modal closes
  useEffect(() => {
    if (!open) {
      setLastAnnouncement(null);
    }
  }, [open]);

  // Handle any user activity to dismiss modal (for inactivity warning only)
  const handleActivity = useCallback(() => {
    if (warningType === 'inactivity') {
      onStayLoggedIn();
    }
  }, [warningType, onStayLoggedIn]);

  // Handle keyboard events including focus trap
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape' && warningType === 'inactivity') {
        e.preventDefault();
        onStayLoggedIn();
      }

      // Focus trap: keep Tab within modal
      if (e.key === 'Tab') {
        const focusableElements = e.currentTarget.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        const firstFocusable = focusableElements[0];
        const lastFocusable = focusableElements[focusableElements.length - 1];

        if (e.shiftKey && document.activeElement === firstFocusable) {
          e.preventDefault();
          lastFocusable?.focus();
        } else if (!e.shiftKey && document.activeElement === lastFocusable) {
          e.preventDefault();
          firstFocusable?.focus();
        }
      }
    },
    [warningType, onStayLoggedIn]
  );

  const isInactivity = warningType === 'inactivity';
  const title = isInactivity
    ? 'Your session is about to expire'
    : 'Your session will end soon';

  const description = isInactivity
    ? 'Due to inactivity, you will be logged out automatically. Move your mouse or press any key to stay logged in.'
    : 'For security, your session will end in 5 minutes. Please save your work and log in again to continue.';

  const buttonText = isInactivity ? 'Stay Logged In' : 'I Understand';

  // Generate announcement text
  const getAnnouncementText = (): string => {
    if (timeRemaining === null) return '';

    if (isInactivity) {
      return `${timeRemaining} seconds until automatic logout. Move or click to stay logged in.`;
    } else {
      return `${timeRemaining} seconds until session ends. Please save your work.`;
    }
  };

  return (
    <Dialog.Root open={open}>
      <Dialog.Portal>
        <Dialog.Overlay
          className="fixed inset-0 z-[100] bg-black/60"
          onClick={handleActivity}
          onMouseMove={handleActivity}
        />
        <Dialog.Content
          role="alertdialog"
          aria-modal="true"
          className="fixed left-1/2 top-1/2 z-[101] w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-background p-6 shadow-xl focus:outline-none"
          onKeyDown={handleKeyDown}
          onMouseMove={handleActivity}
        >
          {/* Screen reader announcement region */}
          <div
            ref={announcementRef}
            role="status"
            aria-live="assertive"
            aria-atomic="true"
            className="sr-only"
          >
            {ANNOUNCEMENT_THRESHOLDS.includes(timeRemaining ?? -1)
              ? getAnnouncementText()
              : ''}
          </div>

          <Dialog.Title className="text-lg font-semibold text-foreground">
            {title}
          </Dialog.Title>

          <Dialog.Description className="mt-2 text-sm text-muted">
            {description}
          </Dialog.Description>

          {/* Countdown Timer */}
          <div className="mt-6 flex flex-col items-center">
            <div
              role="timer"
              aria-label={`Time remaining: ${timeRemaining !== null ? formatTime(timeRemaining) : '0:00'}`}
              className="text-5xl font-bold tabular-nums text-foreground"
            >
              {timeRemaining !== null ? formatTime(timeRemaining) : '0:00'}
            </div>
            <p className="mt-2 text-sm text-muted">
              {isInactivity ? 'until automatic logout' : 'until session ends'}
            </p>
          </div>

          {/* Action Button */}
          <div className="mt-6 flex justify-center">
            <button
              ref={stayLoggedInButtonRef}
              onClick={onStayLoggedIn}
              className="rounded-md bg-accent px-6 py-3 text-base font-medium text-white hover:bg-accent/90 focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2 focus:ring-offset-background"
            >
              {buttonText}
            </button>
          </div>

          {/* Additional info for absolute timeout */}
          {!isInactivity && (
            <p className="mt-4 text-center text-xs text-muted">
              This timeout cannot be extended. Please log in again after your
              session ends.
            </p>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
