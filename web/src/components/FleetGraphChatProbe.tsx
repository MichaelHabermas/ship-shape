// Renders contextual FleetGraph chat for source-aware page and notification discussion.
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent, type KeyboardEvent } from 'react';
import { useFleetGraphChatTurns } from '@/hooks/useFleetGraphChatTurns';
import { useLocation, useNavigate } from 'react-router-dom';
import type {
  FleetGraphChatResponse,
  FleetGraphPageContext,
  FleetGraphRunResponse,
} from '@ship/shared';
import type { FleetGraphNotificationProbeItem } from '@/components/FleetGraphNotificationsProbe';
import {
  ChatTurnList,
  ContextPopover,
  CurrentContextChip,
  EmptyConversation,
  NotificationConversation,
} from '@/components/fleetgraph-chat/ChatConversation';
import {
  ChatIcon,
  ClearIcon,
  CloseIcon,
  ExpandIcon,
  SendIcon,
  ShrinkIcon,
} from '@/components/fleetgraph-chat/ChatProbeIcons';
import {
  buildFleetGraphChatContext,
  chatErrorMessage,
  contextMatchesSource,
  dedupeContextItems,
  displayText,
  getCurrentContextKind,
  getCurrentDocumentId,
  getSurfaceLabel,
  sourcePathForDocumentId,
  type ChatContextItem,
  type ExplanationState,
} from '@/components/fleetgraph-chat/chat-probe-utils';
import { apiGetJson, apiPostJson } from '@/lib/api';
import { getApiErrorStatus } from '@/lib/api-error';

interface DocumentTitleResponse {
  title?: string;
}

export interface FleetGraphChatProbeRequest {
  id: number;
  notification: FleetGraphNotificationProbeItem;
}

export function FleetGraphChatProbe({
  discussRequest,
  pageContext,
}: {
  discussRequest: FleetGraphChatProbeRequest | null;
  pageContext?: FleetGraphPageContext | null;
}) {
  const location = useLocation();
  const navigate = useNavigate();

  const contextMenuRef = useRef<HTMLDivElement>(null);
  const conversationEndRef = useRef<HTMLDivElement>(null);

  const [open, setOpen] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [contextItems, setContextItems] = useState<ChatContextItem[]>([]);
  const [activeNotification, setActiveNotification] = useState<FleetGraphNotificationProbeItem | null>(null);
  const [explanation, setExplanation] = useState<ExplanationState>({ status: 'idle' });
  const [expanded, setExpanded] = useState(false);
  const {
    chatTurns,
    clearTurns,
    beginTurn,
    resolveTurn,
    failTurn,
    setTurnReady,
  } = useFleetGraphChatTurns();

  const surfaceLabel = useMemo(() => getSurfaceLabel(location.pathname), [location.pathname]);
  const currentDocumentId = useMemo(() => getCurrentDocumentId(location.pathname), [location.pathname]);
  const currentContextKind = useMemo(() => getCurrentContextKind(location.pathname), [location.pathname]);
  const currentSourcePath = useMemo(() => (
    currentDocumentId ? sourcePathForDocumentId(currentDocumentId) : undefined
  ), [currentDocumentId]);
  const [currentTitle, setCurrentTitle] = useState(surfaceLabel);
  const extraContextItems = useMemo(
    () => dedupeContextItems(contextItems.filter((item) => !contextMatchesSource(item, currentSourcePath))),
    [contextItems, currentSourcePath]
  );

  const visibleContextItems = extraContextItems.slice(0, 3);
  const overflowContextItems = extraContextItems.slice(3);
  const hasClearableContext = contextItems.length > 0;

  useEffect(() => {
    if (!currentDocumentId) {
      setCurrentTitle(surfaceLabel);
      return;
    }

    let cancelled = false;

    async function loadCurrentTitle() {
      try {
        const document = await apiGetJson<DocumentTitleResponse>(
          `/api/documents/${currentDocumentId}`,
          'Failed to fetch current document'
        );
        if (!cancelled) setCurrentTitle(document.title?.trim() || surfaceLabel);
      } catch {
        if (!cancelled) setCurrentTitle(surfaceLabel);
      }
    }

    void loadCurrentTitle();
    return () => {
      cancelled = true;
    };
  }, [currentDocumentId, surfaceLabel]);

  useEffect(() => {
    setContextItems((items) => items.filter((item) => {
      if (item.notification) return true;
      return !contextMatchesSource(item, currentSourcePath);
    }));
  }, [currentSourcePath]);

  useEffect(() => {
    if (!discussRequest) return;

    const notification = discussRequest.notification;
    setOpen(true);
    setActiveNotification(notification);
    setExplanation(notification.findingId ? { status: 'loading', findingId: notification.findingId } : { status: 'idle' });
    clearTurns();
    setDraft('');
    setContextItems((items) => {
      const contextItem: ChatContextItem = {
        id: `notification:${notification.id}`,
        label: displayText(notification.title),
        sourcePath: notification.sourcePath,
        notification,
        context: {
          kind: 'notification',
          findingId: notification.findingId,
          sourcePath: notification.sourcePath,
        },
      };
      return dedupeContextItems([
        contextItem,
        ...items.filter((item) => item.id !== contextItem.id && !contextMatchesSource(item, notification.sourcePath)),
      ]);
    });
  }, [discussRequest]);

  useEffect(() => {
    if (!activeNotification?.findingId) return;

    let cancelled = false;
    const findingId = activeNotification.findingId;

    async function explainFinding() {
      try {
        const response = await apiPostJson<FleetGraphRunResponse>(
          `/api/fleetgraph/findings/${findingId}/explain`,
          {},
          'Failed to explain notification'
        );
        if (cancelled) return;
        if (response.visibleOutput && !response.visibleOutput.noSafeOutput) {
          setExplanation({ status: 'ready', findingId, output: response.visibleOutput });
        } else {
          setExplanation({ status: 'error', findingId });
        }
      } catch {
        if (!cancelled) setExplanation({ status: 'error', findingId });
      }
    }

    void explainFinding();
    return () => {
      cancelled = true;
    };
  }, [activeNotification]);

  const removeContextItem = (id: string) => {
    setContextItems((items) => items.filter((item) => item.id !== id));
    if (activeNotification && id === `notification:${activeNotification.id}`) {
      setActiveNotification(null);
      setExplanation({ status: 'idle' });
    }
  };

  const activateContextItem = (id: string) => {
    const item = contextItems.find((contextItem) => contextItem.id === id);
    if (!item?.sourcePath) return;

    const previousCurrentContext: ChatContextItem | null = currentSourcePath
      ? {
          id: `current:${currentSourcePath}`,
          label: currentTitle,
          sourcePath: currentSourcePath,
          context: {
            kind: currentContextKind,
            documentId: currentDocumentId ?? undefined,
            sourcePath: currentSourcePath,
          },
        }
      : null;

    setContextItems((items) => {
      const withoutClickedOrPrevious = items.filter((contextItem) => {
        if (contextItem.id === id) return false;
        if (previousCurrentContext && contextMatchesSource(contextItem, previousCurrentContext.sourcePath)) return false;
        return true;
      });
      return dedupeContextItems(previousCurrentContext ? [previousCurrentContext, ...withoutClickedOrPrevious] : withoutClickedOrPrevious);
    });
    setContextOpen(false);
    navigate(item.sourcePath);
  };

  const clearContextItems = () => {
    setContextItems([]);
    setActiveNotification(null);
    setExplanation({ status: 'idle' });
    clearTurns();
    setDraft('');
    setContextOpen(false);
  };

  const addCurrentContext = () => {
    if (!currentDocumentId || !currentSourcePath) return;
    setContextItems((items) => dedupeContextItems([
      {
        id: `attached:${currentSourcePath}`,
        label: currentTitle,
        sourcePath: currentSourcePath,
        attached: true,
        context: {
          kind: currentContextKind,
          documentId: currentDocumentId,
          sourcePath: currentSourcePath,
        },
      },
      ...items,
    ]));
  };

  const handleDraftChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    setDraft(event.target.value);
    event.target.style.height = '0px';
    event.target.style.height = `${Math.min(event.target.scrollHeight, 120)}px`;
    event.target.style.overflowY = event.target.scrollHeight > 120 ? 'auto' : 'hidden';
  };

  const handleDraftKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey) return;
    event.preventDefault();
    if (!draft.trim()) return;
    event.currentTarget.form?.requestSubmit();
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const prompt = draft.trim();
    if (!prompt) return;

    const context = buildFleetGraphChatContext({
      contextItems,
      currentSourcePath,
      activeNotification,
      currentDocumentId,
      currentContextKind,
      pageContext,
    });
    const { turnId, history } = beginTurn(prompt);
    setDraft('');

    if (!context) {
      setTurnReady(turnId, {
        decision: 'quiet_exit',
        answer: {
          title: 'Open a source first',
          body: 'Open an issue, scoped list, week, project, program, document, or notification before asking.',
          sources: [],
          humanGate: { required: false },
        },
      });
      return;
    }

    try {
      const response = await apiPostJson<FleetGraphChatResponse>(
        '/api/fleetgraph/chat',
        { prompt, context, ...(history.length > 0 ? { history } : {}) },
        'Failed to ask Ship'
      );
      resolveTurn(turnId, response);
    } catch (error) {
      const status = getApiErrorStatus(error);
      failTurn(turnId, chatErrorMessage(status));
    }
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

  useEffect(() => {
    if (!open) return;
    conversationEndRef.current?.scrollIntoView({ block: 'end' });
  }, [open, activeNotification, explanation, chatTurns]);

  return (
    <div className="fixed bottom-5 right-5 z-40 flex flex-col items-end gap-3">
      {open && (
        <section
          aria-label="Context chat"
          className={[
            'flex flex-col overflow-hidden rounded-lg border border-border bg-[#111111] shadow-2xl shadow-black/40 transition-[height,width] duration-200',
            expanded
              ? 'h-[min(780px,calc(100vh-3rem))] w-[min(760px,calc(100vw-3rem))]'
              : 'h-[min(620px,calc(100vh-7rem))] w-[min(420px,calc(100vw-2.5rem))]',
          ].join(' ')}
        >
          <header className="relative flex items-center justify-between border-b border-border px-3.5 pb-2.5 pt-2">
            <div className="min-w-0 flex-1 pr-2">
              <div className="flex max-h-[52px] min-w-0 flex-wrap items-center gap-1.5 overflow-hidden">
                <CurrentContextChip title={currentTitle} />
                <button
                  type="button"
                  onClick={addCurrentContext}
                  disabled={!currentDocumentId || contextItems.some((item) => item.attached && contextMatchesSource(item, currentSourcePath))}
                  className="shrink-0 rounded border border-border bg-background px-1.5 py-0.5 text-[11px] leading-4 text-muted transition hover:border-[#3a3a3a] hover:bg-white/5 hover:text-foreground disabled:cursor-default disabled:opacity-40"
                  aria-label="Add current page to chat context"
                  title="Add current page to chat context"
                >
                  +
                </button>
                {visibleContextItems.map((item) => (
                  <span key={item.id} className="flex max-w-[calc((100%-2.75rem)/2)] shrink-0 overflow-hidden rounded border border-border bg-background text-[11px] leading-4 text-muted">
                    <button
                      type="button"
                      onClick={() => activateContextItem(item.id)}
                      className="min-w-0 px-1.5 py-0.5 transition hover:text-foreground focus:outline-none focus:ring-2 focus:ring-accent"
                    >
                      <span className="block truncate">{displayText(item.label)}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => removeContextItem(item.id)}
                      className="px-1 text-xs leading-none text-muted transition hover:text-foreground focus:outline-none focus:ring-2 focus:ring-accent"
                      aria-label={`Remove ${displayText(item.label)} from context`}
                    >
                      x
                    </button>
                  </span>
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
              </div>
            </div>
            <div className="ml-3 flex shrink-0 items-center rounded-md border border-border bg-background/70">
              <button
                type="button"
                onClick={clearContextItems}
                disabled={!hasClearableContext && chatTurns.length === 0}
                className="flex h-8 w-8 items-center justify-center text-muted transition hover:bg-white/5 hover:text-foreground focus:outline-none focus:ring-2 focus:ring-accent disabled:cursor-default disabled:opacity-35"
                aria-label="Clear chat"
                title="Clear chat"
              >
                <ClearIcon />
              </button>
              <button
                type="button"
                onClick={() => setExpanded((value) => !value)}
                className="flex h-8 w-8 items-center justify-center border-l border-border text-muted transition hover:bg-white/5 hover:text-foreground focus:outline-none focus:ring-2 focus:ring-accent"
                aria-label={expanded ? 'Shrink chat' : 'Expand chat'}
                title={expanded ? 'Shrink chat' : 'Expand chat'}
              >
                {expanded ? <ShrinkIcon /> : <ExpandIcon />}
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="flex h-8 w-8 items-center justify-center border-l border-border text-muted transition hover:bg-white/5 hover:text-foreground focus:outline-none focus:ring-2 focus:ring-accent"
                aria-label="Close chat"
                title="Close chat"
              >
                <CloseIcon />
              </button>
            </div>

            {contextOpen && (
              <ContextPopover
                popoverRef={contextMenuRef}
                surfaceLabel={surfaceLabel}
                contextItems={overflowContextItems}
                onActivateContext={activateContextItem}
                onRemoveContext={removeContextItem}
              />
            )}
          </header>

          <div className="scrollbar-hide flex min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-5">
            {activeNotification ? (
              <div className="flex min-h-full w-full flex-col gap-4">
                <div className="flex-1" aria-hidden="true" />
                <NotificationConversation notification={activeNotification} explanation={explanation} />
                <ChatTurnList turns={chatTurns} />
                <div ref={conversationEndRef} aria-hidden="true" />
              </div>
            ) : chatTurns.length > 0 ? (
              <div className="flex min-h-full w-full flex-col gap-4">
                <div className="flex-1" aria-hidden="true" />
                <ChatTurnList turns={chatTurns} />
                <div ref={conversationEndRef} aria-hidden="true" />
              </div>
            ) : (
              <EmptyConversation surfaceLabel={surfaceLabel} />
            )}
          </div>

          <form className="border-t border-border p-3" onSubmit={handleSubmit}>
            <label className="sr-only" htmlFor="context-chat-draft">Message</label>
            <div className="flex items-end gap-3 rounded-lg border border-border bg-background px-3 py-3 focus-within:border-accent focus-within:ring-1 focus-within:ring-accent">
              <textarea
                id="context-chat-draft"
                value={draft}
                onChange={handleDraftChange}
                onKeyDown={handleDraftKeyDown}
                rows={1}
                placeholder={activeNotification ? 'Ask anything...' : `Ask about this ${surfaceLabel.toLowerCase()}...`}
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

      {(!open || !expanded) && (
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="flex h-14 w-14 items-center justify-center rounded-full border border-[#1f6fae] bg-accent text-white shadow-lg shadow-black/35 transition hover:bg-accent-hover focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2 focus:ring-offset-background"
          aria-label={open ? 'Hide chat' : 'Open chat'}
          aria-expanded={open}
        >
          <ChatIcon />
        </button>
      )}
    </div>
  );
}
