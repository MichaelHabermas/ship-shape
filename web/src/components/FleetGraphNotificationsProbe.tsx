// Renders the left-rail notification surface backed by real FleetGraph findings.
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type {
  FleetGraphNotificationResponse,
  FleetGraphNotificationsListResponse,
} from '@/api/schemas';
import { NotificationLabelChip } from '@/components/NotificationLabelChip';
import { apiGetJson } from '@/lib/api';

export type FleetGraphNotificationProbeItem = Pick<
  FleetGraphNotificationResponse,
  'id' | 'findingId' | 'title' | 'owner' | 'context' | 'blockerText' | 'sourcePath' | 'detectedAt'
> & {
  age: string;
};

function getNotificationCountLabel(count: number): string {
  return count > 99 ? '99+' : String(count);
}

function displayText(value: string): string {
  return value.replace(/\bFleetGraph\b/g, 'Ship');
}

export function FleetGraphNotificationsProbe({
  onDiscuss,
}: {
  onDiscuss: (notification: FleetGraphNotificationProbeItem) => void;
}) {
  const navigate = useNavigate();
  const containerRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<FleetGraphNotificationProbeItem[]>([]);
  const [loadStatus, setLoadStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const notificationCount = notifications.length;

  useEffect(() => {
    let cancelled = false;

    async function loadNotifications() {
      try {
        const data = await apiGetJson<FleetGraphNotificationsListResponse>(
          '/api/fleetgraph/notifications?limit=25',
          'Failed to fetch notifications'
        );
        if (cancelled) return;
        setNotifications(data.notifications.map((notification) => ({
          id: notification.id,
          findingId: notification.findingId,
          title: notification.title,
          owner: notification.owner,
          context: notification.context,
          blockerText: notification.blockerText,
          sourcePath: notification.sourcePath,
          detectedAt: notification.detectedAt,
          age: formatNotificationAge(notification.detectedAt),
        })));
        setLoadStatus('ready');
      } catch {
        if (!cancelled) {
          setNotifications([]);
          setLoadStatus('error');
        }
      }
    }

    void loadNotifications();
    const interval = window.setInterval(() => void loadNotifications(), 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

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
          <header className="flex items-center justify-between border-b border-border px-3 py-1.5">
            <div className="text-sm font-medium text-foreground">Notifications</div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="flex h-7 w-7 items-center justify-center rounded-md text-muted transition hover:bg-white/5 hover:text-foreground focus:outline-none focus:ring-2 focus:ring-accent"
              aria-label="Close notifications"
            >
              <CloseIcon />
            </button>
          </header>

          <div className="scrollbar-hide max-h-[440px] overflow-y-auto">
            {notifications.length === 0 && (
              <NotificationEmptyState status={loadStatus} />
            )}
            {notifications.map((notification) => (
              <BlockedIssueNotification
                key={notification.id}
                notification={notification}
                onDiscuss={() => onDiscuss(notification)}
                onOpenSource={() => {
                  if (notification.sourcePath) navigate(notification.sourcePath);
                }}
              />
            ))}
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

function NotificationEmptyState({ status }: { status: 'loading' | 'ready' | 'error' }) {
  const text = status === 'error'
    ? 'Notifications could not load.'
    : status === 'loading'
      ? 'Loading notifications...'
      : 'No active notifications.';

  return (
    <div className="px-3 py-6 text-sm leading-5 text-muted">
      {text}
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
  notification,
  onDiscuss,
  onOpenSource,
}: {
  notification: FleetGraphNotificationProbeItem;
  onDiscuss: () => void;
  onOpenSource: () => void;
}) {
  const ownerLabel = notification.owner || '-';

  return (
    <article className="border-b border-border bg-background/70 px-3 py-2 last:border-b-0">
      <div className="mb-1 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="flex min-w-0 items-center gap-1.5 text-sm font-medium leading-5 text-foreground">
            <NotificationLabelChip label="Blocked" />
            <span className="truncate">{displayText(notification.title)}</span>
          </h3>
          <div className="mt-0.5 flex flex-wrap gap-1.5 text-[11px] leading-4 text-muted">
            <span>{notification.age}</span>
            <span aria-hidden="true">·</span>
            <span>{displayText(ownerLabel)}</span>
            <span aria-hidden="true">·</span>
            <span>{displayText(notification.context)}</span>
          </div>
        </div>
        <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-accent" />
      </div>

      <p className="line-clamp-2 text-sm leading-5 text-muted">{displayText(notification.blockerText)}</p>

      <div className="mt-1.5 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={!notification.sourcePath}
          onClick={onOpenSource}
          className="rounded border border-border px-2.5 py-1 text-xs text-foreground transition hover:border-[#3a3a3a] hover:bg-white/5"
        >
          Open source
        </button>
        <button
          type="button"
          onClick={onDiscuss}
          className="rounded bg-accent px-2.5 py-1 text-xs text-white transition hover:bg-accent-hover"
        >
          Discuss
        </button>
      </div>
    </article>
  );
}

function formatNotificationAge(value: string): string {
  const detectedAt = new Date(value).getTime();
  if (!Number.isFinite(detectedAt)) return '-';

  const elapsedMs = Math.max(0, Date.now() - detectedAt);
  const minutes = Math.floor(elapsedMs / 60_000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;

  return `${Math.floor(hours / 24)}d`;
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
