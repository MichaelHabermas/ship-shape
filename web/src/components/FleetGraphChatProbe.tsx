import { useEffect, useMemo, useRef, useState, type ChangeEvent, type RefObject } from 'react';
import { useLocation } from 'react-router-dom';
import type { FleetGraphNotificationProbeItem } from '@/components/FleetGraphNotificationsProbe';

interface ChatContextItem {
  id: string;
  label: string;
  notification?: FleetGraphNotificationProbeItem;
}

export interface FleetGraphChatProbeRequest {
  id: number;
  notification: FleetGraphNotificationProbeItem;
}

const seededContextItems: ChatContextItem[] = [
  { id: 'project-delta', label: 'Project Delta' },
  { id: 'sprint-12', label: 'Sprint 12' },
  { id: 'dev-user', label: 'Dev User' },
  { id: 'auth-rollout', label: 'Auth rollout' },
  { id: 'backend-queue', label: 'Backend queue' },
  { id: 'contract-review', label: 'Contract review' },
  { id: 'standup-note', label: 'Standup note' },
  { id: 'release-risk', label: 'Release risk' },
  { id: 'pm-thread', label: 'PM thread' },
  { id: 'security-review', label: 'Security review' },
  { id: 'api-logs', label: 'API logs' },
  { id: 'access-request', label: 'Access request' },
  { id: 'customer-note', label: 'Customer note' },
];

function getSurfaceLabel(pathname: string): string {
  if (pathname.startsWith('/documents/')) return 'Current document';
  if (pathname.startsWith('/issues')) return 'Issues';
  if (pathname.startsWith('/projects')) return 'Projects';
  if (pathname.startsWith('/programs')) return 'Programs';
  if (pathname.startsWith('/my-week')) return 'My Week';
  if (pathname.startsWith('/team/')) return 'Team';
  if (pathname.startsWith('/docs')) return 'Docs';
  return 'Current view';
}

export function FleetGraphChatProbe({ discussRequest }: { discussRequest: FleetGraphChatProbeRequest | null }) {
  const location = useLocation();
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [contextItems, setContextItems] = useState<ChatContextItem[]>(seededContextItems);
  const [activeNotification, setActiveNotification] = useState<FleetGraphNotificationProbeItem | null>(null);
  const surfaceLabel = useMemo(() => getSurfaceLabel(location.pathname), [location.pathname]);
  const visibleContextItems = contextItems.slice(0, 3);
  const overflowContextItems = contextItems.slice(3);
  const hasClearableContext = contextItems.length > 0;

  useEffect(() => {
    if (!discussRequest) return;

    const notification = discussRequest.notification;
    setOpen(true);
    setActiveNotification(notification);
    setContextItems((items) => {
      const contextItem: ChatContextItem = {
        id: `notification:${notification.id}`,
        label: notification.title,
        notification,
      };
      return [contextItem, ...items.filter((item) => item.id !== contextItem.id)];
    });
  }, [discussRequest]);

  const removeContextItem = (id: string) => {
    setContextItems((items) => items.filter((item) => item.id !== id));
    if (activeNotification && id === `notification:${activeNotification.id}`) {
      setActiveNotification(null);
    }
  };

  const clearContextItems = () => {
    setContextItems([]);
    setActiveNotification(null);
    setContextOpen(false);
  };

  const handleDraftChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    setDraft(event.target.value);
    event.target.style.height = '0px';
    event.target.style.height = `${Math.min(event.target.scrollHeight, 120)}px`;
    event.target.style.overflowY = event.target.scrollHeight > 120 ? 'auto' : 'hidden';
  };

  useEffect(() => {
    if (!contextOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (contextMenuRef.current?.contains(event.target as Node)) return;
      setContextOpen(false);
    };

    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [contextOpen]);

  return (
    <div className="fixed bottom-5 right-5 z-40 flex flex-col items-end gap-3">
      {open && (
        <section
          aria-label="Context chat"
          className="flex h-[min(620px,calc(100vh-7rem))] w-[min(420px,calc(100vw-2.5rem))] flex-col overflow-hidden rounded-lg border border-border bg-[#111111] shadow-2xl shadow-black/40"
        >
          <header className="relative flex items-center justify-between border-b border-border px-3.5 pb-2.5 pt-2">
            <div className="min-w-0 pr-2">
              <div className="flex max-h-[52px] min-w-0 flex-wrap gap-1.5 overflow-hidden">
                <span className="shrink-0 rounded border border-border bg-background px-1.5 py-0.5 text-[11px] leading-4 text-muted">
                  {surfaceLabel} - Untitled
                </span>
                {visibleContextItems.map((item) => (
                  <button
                    type="button"
                    key={item.id}
                    onClick={() => removeContextItem(item.id)}
                    className="flex shrink-0 items-center gap-1 rounded border border-border bg-background px-1.5 py-0.5 text-[11px] leading-4 text-muted transition hover:border-[#3a3a3a] hover:text-foreground"
                  >
                    {item.label}
                    <span aria-hidden="true" className="text-xs leading-none text-muted">x</span>
                  </button>
                ))}
                {overflowContextItems.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setContextOpen((value) => !value)}
                    className="shrink-0 rounded border border-border bg-[#171717] px-1.5 py-0.5 text-[11px] leading-4 text-foreground transition hover:border-[#3a3a3a] hover:bg-white/5"
                    aria-expanded={contextOpen}
                  >
                    +{overflowContextItems.length}
                  </button>
                )}
                <button
                  type="button"
                  onClick={clearContextItems}
                  disabled={!hasClearableContext}
                  className="shrink-0 rounded border border-red-500/40 bg-red-500/10 px-1.5 py-0.5 text-[11px] leading-4 text-red-300 transition hover:border-red-400 hover:bg-red-500/20 disabled:cursor-default disabled:border-border disabled:bg-background disabled:text-muted/50"
                  aria-label="Clear added context"
                >
                  C
                </button>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="ml-3 flex h-8 w-8 items-center justify-center rounded-md text-muted transition hover:bg-white/5 hover:text-foreground focus:outline-none focus:ring-2 focus:ring-accent"
              aria-label="Close chat"
            >
              <CloseIcon />
            </button>

            {contextOpen && (
              <ContextPopover
                popoverRef={contextMenuRef}
                surfaceLabel={surfaceLabel}
                contextItems={overflowContextItems}
                onRemoveContext={removeContextItem}
              />
            )}
          </header>

          <div className="scrollbar-hide flex flex-1 overflow-y-auto px-4 py-5">
            {activeNotification ? (
              <NotificationConversation notification={activeNotification} />
            ) : (
              <EmptyConversation surfaceLabel={surfaceLabel} />
            )}
          </div>

          <form className="border-t border-border p-3" onSubmit={(event) => event.preventDefault()}>
            <label className="sr-only" htmlFor="context-chat-draft">Message</label>
            <div className="flex items-end gap-3 rounded-lg border border-border bg-background px-3 py-3 focus-within:border-accent focus-within:ring-1 focus-within:ring-accent">
              <textarea
                id="context-chat-draft"
                value={draft}
                onChange={handleDraftChange}
                rows={1}
                placeholder="Ask about this..."
                className="scrollbar-hide max-h-[120px] min-h-6 flex-1 resize-none overflow-hidden border-0 bg-transparent px-0 py-0.5 text-sm leading-5 text-foreground outline-none ring-0 placeholder:text-muted focus:outline-none focus:ring-0"
              />
              <button
                type="submit"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-accent text-white transition hover:bg-accent-hover focus:outline-none focus:ring-2 focus:ring-accent disabled:cursor-default disabled:opacity-40"
                aria-label="Send message"
                disabled={!draft.trim()}
              >
                <SendIcon />
              </button>
            </div>
          </form>
        </section>
      )}

      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex h-14 w-14 items-center justify-center rounded-full border border-[#1f6fae] bg-accent text-white shadow-lg shadow-black/35 transition hover:bg-accent-hover focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2 focus:ring-offset-background"
        aria-label={open ? 'Hide chat' : 'Open chat'}
        aria-expanded={open}
      >
        <ChatIcon />
      </button>
    </div>
  );
}

function ContextPopover({
  popoverRef,
  surfaceLabel,
  contextItems,
  onRemoveContext,
}: {
  popoverRef: RefObject<HTMLDivElement>;
  surfaceLabel: string;
  contextItems: ChatContextItem[];
  onRemoveContext: (id: string) => void;
}) {
  return (
    <div ref={popoverRef} className="absolute right-10 top-[calc(100%-4px)] z-10 w-[280px] rounded-lg border border-border bg-[#111111] p-2 shadow-xl shadow-black/40">
      <div className="scrollbar-hide max-h-56 space-y-1 overflow-y-auto">
        <div className="rounded px-2 py-1.5 text-xs text-muted">
          {surfaceLabel} - Untitled
        </div>
        {contextItems.map((item) => (
          <button
            type="button"
            key={item.id}
            onClick={() => onRemoveContext(item.id)}
            className="flex w-full items-center justify-between rounded border border-transparent px-2 py-1.5 text-left text-xs text-muted transition hover:border-border hover:text-foreground"
          >
            <span>{item.label}</span>
            <span aria-hidden="true" className="text-xs text-muted">x</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function EmptyConversation({ surfaceLabel }: { surfaceLabel: string }) {
  return (
    <div className="flex flex-1 items-center justify-center px-4 text-center">
      <div className="flex max-w-[280px] flex-col items-center gap-4">
        <p className="text-sm leading-6 text-muted">
          Ask about this {surfaceLabel.toLowerCase()}.
        </p>
        <PromptChips />
      </div>
    </div>
  );
}

function NotificationConversation({ notification }: { notification: FleetGraphNotificationProbeItem }) {
  const ownerLabel = notification.owner || '-';
  const sourceLabels = ['Latest blocker update', notification.context, ownerLabel].filter(
    (label, index, labels) => label !== '-' && labels.indexOf(label) === index
  );

  return (
    <div className="flex w-full flex-col gap-3">
      <div className="self-end rounded-lg bg-accent px-3.5 py-2.5 text-sm leading-5 text-white">
        Why is this blocked?
      </div>

      <div className="w-full text-foreground">
        <p className="mb-1 text-[11px] leading-4 text-muted">Blocked - {notification.title}</p>
        <p className="text-base leading-6">
          {notification.blockerText}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] leading-4 text-muted">
          <span>{ownerLabel}</span>
          <span aria-hidden="true">·</span>
          <span>{notification.context}</span>
          <span aria-hidden="true">·</span>
          <span>{notification.age}</span>
          <span aria-hidden="true" className="text-muted/60">/</span>
          {sourceLabels.map((label, index) => (
            <span key={label} className="inline-flex items-center gap-1">
              {index > 0 && <span aria-hidden="true">·</span>}
              <button type="button" className="hover:text-foreground">{label}</button>
            </span>
          ))}
        </div>
      </div>

      <div className="w-full rounded-lg border border-border bg-background/60 p-3">
        <p className="text-xs font-medium text-foreground">Possible next step</p>
        <p className="mt-1 text-sm leading-5 text-muted">
          Ask the connected owner to confirm the unblocker and the next handoff.
        </p>
        <button
          type="button"
          className="mt-3 rounded-md border border-border px-3 py-1.5 text-xs text-foreground transition hover:border-[#3a3a3a] hover:bg-white/5"
        >
          Draft message
        </button>
      </div>

      <div className="self-end rounded-lg bg-accent px-3.5 py-2.5 text-sm leading-5 text-white">
        What changed since yesterday?
      </div>

      <div className="w-full text-foreground">
        <p className="text-base leading-6">
          The latest non-empty blocker update is now the active explanation for the notification.
        </p>
        <p className="mt-1 text-[13px] leading-[18px] text-muted">
          The notification should stay visible while the issue remains blocked, then disappear when the source issue is unblocked.
        </p>
      </div>

      <div className="self-end rounded-lg bg-accent px-3.5 py-2.5 text-sm leading-5 text-white">
        Who should I ask?
      </div>

      <div className="w-full text-foreground">
        <p className="text-base leading-6">
          Start with {ownerLabel}. If that is not enough, route through {notification.context}.
        </p>
        <p className="mt-1 text-[13px] leading-[18px] text-muted">
          I would avoid broadcasting this to the whole workspace until the owner path is exhausted.
        </p>
      </div>

      <div className="w-full rounded-lg border border-border bg-background/60 p-3">
        <p className="text-xs font-medium text-foreground">Draft nudge</p>
        <p className="mt-1 text-sm leading-5 text-muted">
          Can you confirm who owns the unblocker for {notification.title}?
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded-md border border-border px-3 py-1.5 text-xs text-foreground transition hover:border-[#3a3a3a] hover:bg-white/5"
          >
            Use draft
          </button>
          <button
            type="button"
            className="rounded-md border border-border px-3 py-1.5 text-xs text-muted transition hover:border-[#3a3a3a] hover:text-foreground"
          >
            Edit first
          </button>
        </div>
      </div>

      <PromptChips />
    </div>
  );
}

function PromptChips() {
  return (
    <div className="flex flex-wrap gap-2">
      <button
        type="button"
        className="rounded-md border border-border px-3 py-1.5 text-xs text-muted transition hover:border-[#3a3a3a] hover:text-foreground"
      >
        What changed?
      </button>
      <button
        type="button"
        className="rounded-md border border-border px-3 py-1.5 text-xs text-muted transition hover:border-[#3a3a3a] hover:text-foreground"
      >
        What needs attention?
      </button>
    </div>
  );
}

function ChatIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M5 6.5A3.5 3.5 0 0 1 8.5 3h7A3.5 3.5 0 0 1 19 6.5v5A3.5 3.5 0 0 1 15.5 15H11l-4.5 4v-4.2A3.5 3.5 0 0 1 5 11.5v-5Z" />
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

function SendIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="m4 12 16-8-5 16-3-7-8-1Z" />
    </svg>
  );
}
