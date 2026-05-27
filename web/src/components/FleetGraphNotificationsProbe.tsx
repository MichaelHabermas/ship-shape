import { useEffect, useRef, useState } from 'react';

const notificationCount = 3;

function getNotificationCountLabel(count: number): string {
  return count > 99 ? '99+' : String(count);
}

export function FleetGraphNotificationsProbe() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (containerRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    };

    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [open]);

  return (
    <div ref={containerRef} className="fixed bottom-[84px] left-[6px] z-30 flex flex-col gap-2">
      {open && (
        <section
          aria-label="Notifications"
          className="absolute bottom-0 left-[42px] w-[min(380px,calc(100vw-4rem))] overflow-hidden rounded-lg border border-border bg-[#111111] shadow-2xl shadow-black/40"
        >
          <header className="flex items-center justify-between border-b border-border px-3 py-2.5">
            <div className="text-sm font-medium text-foreground">Notifications</div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="flex h-8 w-8 items-center justify-center rounded-md text-muted transition hover:bg-white/5 hover:text-foreground focus:outline-none focus:ring-2 focus:ring-accent"
              aria-label="Close notifications"
            >
              <CloseIcon />
            </button>
          </header>

          <div className="scrollbar-hide max-h-[440px] overflow-y-auto">
            <BlockedIssueNotification
              title="API access blocker"
              age="2d"
              owner="Dev User"
              context="Project Delta"
              blockerText="Waiting on API access before backend queue work can continue."
            />
            <BlockedIssueNotification
              title="Contract review"
              age="18h"
              owner="-"
              context="Auth rollout"
              blockerText="Next review step is named, but no connected owner is assigned."
            />
            <BlockedIssueNotification
              title="Release risk"
              age="5h"
              owner="PM thread"
              context="Sprint 12"
              blockerText="Two linked issues depend on the same access request."
            />
            <BlockedIssueNotification
              title="Backend queue"
              age="4h"
              owner="Dev User"
              context="Backend queue"
              blockerText="Next item is ready, but the review handoff has not moved."
            />
            <BlockedIssueNotification
              title="Standup note"
              age="3h"
              owner="-"
              context="Standup note"
              blockerText="Same access blocker appears in today's update without an owner."
            />
            <BlockedIssueNotification
              title="Release risk"
              age="1h"
              owner="Project Delta"
              context="Release risk"
              blockerText="A second dependent issue now points to the same unresolved handoff."
            />
          </div>
        </section>
      )}

      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label={open ? 'Hide notifications' : 'Open notifications'}
        aria-expanded={open}
        className="relative flex h-9 w-9 items-center justify-center rounded-lg text-muted transition hover:bg-border/50 hover:text-foreground focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2 focus:ring-offset-background"
      >
        <BellIcon />
        <NotificationBadge count={notificationCount} />
      </button>
    </div>
  );
}

function NotificationBadge({ count }: { count: number }) {
  return (
    <span className="absolute left-5 top-0 flex h-4 min-w-4 -translate-y-1/3 items-center justify-center rounded-full bg-accent px-1 text-[9px] font-medium leading-none text-white">
      {getNotificationCountLabel(count)}
    </span>
  );
}

function BlockedIssueNotification({
  title,
  age,
  owner,
  context,
  blockerText,
}: {
  title: string;
  age: string;
  owner: string;
  context: string;
  blockerText: string;
}) {
  return (
    <article className="border-b border-border bg-background/70 px-3 py-2 last:border-b-0">
      <div className="mb-1 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="line-clamp-1 text-sm font-medium leading-5 text-foreground">Blocked - {title}</h3>
          <div className="mt-0.5 flex flex-wrap gap-1.5 text-[11px] leading-4 text-muted">
            <span>{age}</span>
            <span aria-hidden="true">·</span>
            <span>{owner}</span>
            <span aria-hidden="true">·</span>
            <span>{context}</span>
          </div>
        </div>
        <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-accent" />
      </div>

      <p className="line-clamp-2 text-sm leading-5 text-muted">{blockerText}</p>

      <div className="mt-1.5 flex flex-wrap gap-2">
        <button
          type="button"
          className="rounded border border-border px-2.5 py-1 text-xs text-foreground transition hover:border-[#3a3a3a] hover:bg-white/5"
        >
          Open source
        </button>
        <button
          type="button"
          className="rounded bg-accent px-2.5 py-1 text-xs text-white transition hover:bg-accent-hover"
        >
          Discuss
        </button>
      </div>
    </article>
  );
}

function BellIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9Z" />
      <path d="M10 21h4" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="m6 6 12 12M18 6 6 18" />
    </svg>
  );
}
