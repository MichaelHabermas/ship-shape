// Renders the left-rail notification surface backed by real FleetGraph findings.
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type {
  FleetGraphNotificationResponse,
  FleetGraphNotificationsListResponse,
} from '@ship/shared';
import { NotificationLabelChip } from '@/components/NotificationLabelChip';
import { apiGetJson, apiPostJson } from '@/lib/api';

export type FleetGraphNotificationProbeItem = Pick<
  FleetGraphNotificationResponse,
  'id' | 'findingId' | 'signalType' | 'signalLabel' | 'reason' | 'title' | 'owner' | 'context' | 'notificationText' | 'blockerText' | 'sourcePath' | 'detectedAt'
> & {
  age: string;
  isRead: boolean;
  readAt: string | null;
};

const SIGNAL_ORDER = ['blocked', 'stale', 'at_risk'] as const;
type NotificationSignalType = typeof SIGNAL_ORDER[number];

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
  const [expandedNotifications, setExpandedNotifications] = useState<Record<string, boolean>>({});
  const [loadStatus, setLoadStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const notificationCount = notifications.length;
  const unreadCount = notifications.filter((notification) => !notification.isRead).length;
  const signalCounts = SIGNAL_ORDER.map((signalType) => ({
    signalType,
    label: notifications.find((notification) => notification.signalType === signalType)?.signalLabel ?? signalType,
    count: notifications.filter((notification) => notification.signalType === signalType).length,
  })).filter((item) => item.count > 0);

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
          signalType: notification.signalType,
          signalLabel: notification.signalLabel,
          reason: notification.reason,
          title: notification.title,
          owner: notification.owner,
          context: notification.context,
          notificationText: notification.notificationText,
          blockerText: notification.blockerText,
          sourcePath: notification.sourcePath,
          detectedAt: notification.detectedAt,
          isRead: notification.isRead,
          readAt: notification.readAt,
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

  async function markRead(notification: FleetGraphNotificationProbeItem) {
    if (notification.isRead) return;
    setNotifications((items) => items.map((item) => (
      item.findingId === notification.findingId
        ? { ...item, isRead: true, readAt: new Date().toISOString() }
        : item
    )));
    try {
      await apiPostJson(
        `/api/fleetgraph/findings/${notification.findingId}/read`,
        {},
        'Failed to mark notification read'
      );
    } catch {
      setNotifications((items) => items.map((item) => (
        item.findingId === notification.findingId
          ? { ...item, isRead: notification.isRead, readAt: notification.readAt }
          : item
      )));
    }
  }

  return (
    <div ref={containerRef} className="fixed bottom-[84px] left-[6px] z-30 flex flex-col gap-2">
      {open && (
        <section
          aria-label="Notifications"
          className="absolute bottom-0 left-[42px] w-[min(380px,calc(100vw-4rem))] overflow-hidden rounded-lg border border-border bg-[#111111] shadow-2xl shadow-black/40"
        >
          <header className="flex items-center justify-between gap-3 border-b border-border px-3 py-1.5">
            <div className="flex min-w-0 items-center gap-2">
              <div className="shrink-0 text-sm font-medium text-foreground">Notifications</div>
              {signalCounts.length > 0 && (
                <div className="flex min-w-0 flex-wrap items-center gap-1">
                  {signalCounts.map((item) => (
                    <SignalCountPill
                      key={item.signalType}
                      signalType={item.signalType}
                      label={item.label}
                      count={item.count}
                    />
                  ))}
                </div>
              )}
            </div>
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
              <AttentionNotification
                key={notification.id}
                notification={notification}
                expanded={expandedNotifications[notification.id] === true}
                onToggle={() => {
                  void markRead(notification);
                  setExpandedNotifications((items) => ({
                    ...items,
                    [notification.id]: items[notification.id] !== true,
                  }));
                }}
                onDiscuss={() => {
                  void markRead(notification);
                  onDiscuss(notification);
                }}
                onOpenSource={() => {
                  void markRead(notification);
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
        <NotificationBadge count={unreadCount || notificationCount} />
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

function SignalCountPill({
  signalType,
  label,
  count,
}: {
  signalType: NotificationSignalType;
  label: string;
  count: number;
}) {
  return (
    <NotificationLabelChip label={`${label} ${count}`} signalType={signalType} />
  );
}

function AttentionNotification({
  notification,
  expanded,
  onToggle,
  onDiscuss,
  onOpenSource,
}: {
  notification: FleetGraphNotificationProbeItem;
  expanded: boolean;
  onToggle: () => void;
  onDiscuss: () => void;
  onOpenSource: () => void;
}) {
  const ownerLabel = notification.owner || '-';

  return (
    <article className={`border-t border-border/70 px-3 py-1.5 first:border-t-0 ${notification.isRead ? 'bg-background/70' : 'bg-accent/5'}`}>
      <div className="grid grid-cols-[minmax(0,1fr)_10px] items-start gap-2">
        <div className="min-w-0">
          <button
            type="button"
            onClick={onToggle}
            className="flex w-full min-w-0 items-center gap-1.5 text-left text-[13px] font-medium leading-5 text-foreground transition hover:text-white focus:outline-none focus:ring-2 focus:ring-accent"
            aria-expanded={expanded}
          >
            <NotificationLabelChip label={notification.signalLabel} signalType={notification.signalType} />
            <span className="min-w-0 truncate">{displayText(titleWithoutSignalPrefix(notification.title, notification.signalLabel))}</span>
          </button>
          {expanded && (
            <div className="mt-0.5 flex flex-wrap gap-1.5 text-[11px] leading-4 text-muted">
              <span>{displayText(ownerLabel)}</span>
              <span aria-hidden="true">·</span>
              <span>{displayText(notification.context)}</span>
              <span aria-hidden="true">·</span>
              <span>{notification.age}</span>
            </div>
          )}
        </div>
        <span
          aria-label={notification.isRead ? undefined : 'Unread'}
          className={`mt-2 h-1.5 w-1.5 rounded-full ${notification.isRead ? 'bg-transparent' : 'bg-accent/70'}`}
          title={notification.isRead ? undefined : 'Unread'}
        />
      </div>

      {expanded && (
        <>
          <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted">{displayText(notification.reason || notification.notificationText || notification.blockerText)}</p>

          <div className="mt-1 flex flex-wrap gap-1.5">
            <button
              type="button"
              disabled={!notification.sourcePath}
              onClick={onOpenSource}
              className="flex h-8 items-center rounded border border-border px-2.5 text-xs text-foreground transition hover:border-[#3a3a3a] hover:bg-white/5 focus:outline-none focus:ring-2 focus:ring-accent disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-border disabled:hover:bg-transparent"
            >
              Open source
            </button>
            <button
              type="button"
              onClick={onDiscuss}
              className="flex h-8 items-center rounded bg-accent px-2.5 text-xs text-white transition hover:bg-accent-hover focus:outline-none focus:ring-2 focus:ring-accent"
            >
              Discuss
            </button>
          </div>
        </>
      )}
    </article>
  );
}

function titleWithoutSignalPrefix(title: string, signalLabel: string): string {
  const prefix = `${signalLabel}:`;
  return title.toLowerCase().startsWith(prefix.toLowerCase())
    ? title.slice(prefix.length).trim()
    : title;
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
