// Renders contextual FleetGraph chat for source-aware page and notification discussion.
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent, type KeyboardEvent, type RefObject } from 'react';
import ReactMarkdown from 'react-markdown';
import { useLocation, useNavigate } from 'react-router-dom';
import type {
  FleetGraphChatContext,
  FleetGraphChatHistoryEntry,
  FleetGraphChatResponse,
  FleetGraphEvidence,
  FleetGraphPageContext,
  FleetGraphRunResponse,
  FleetGraphVisibleOutput,
} from '@ship/shared';
import { FLEETGRAPH_CHAT_HISTORY_LIMIT } from '@ship/shared';
import type { FleetGraphNotificationProbeItem } from '@/components/FleetGraphNotificationsProbe';
import { NotificationLabelChip } from '@/components/NotificationLabelChip';
import { apiGetJson, apiPostJson } from '@/lib/api';
import { getApiErrorStatus } from '@/lib/api-error';

interface ChatContextItem {
  id: string;
  label: string;
  sourcePath?: string;
  notification?: FleetGraphNotificationProbeItem;
  context: FleetGraphChatContext;
  attached?: boolean;
}

interface DocumentTitleResponse {
  title?: string;
}

type ExplanationState =
  | { status: 'idle' }
  | { status: 'loading'; findingId: string }
  | { status: 'ready'; findingId: string; output: FleetGraphVisibleOutput }
  | { status: 'error'; findingId?: string };

interface ChatTurn {
  id: number;
  prompt: string;
  status: 'loading' | 'ready' | 'error';
  response?: Pick<FleetGraphChatResponse, 'decision' | 'answer'>;
  errorMessage?: string;
}

export interface FleetGraphChatProbeRequest {
  id: number;
  notification: FleetGraphNotificationProbeItem;
}

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

function getCurrentDocumentId(pathname: string): string | null {
  const match = pathname.match(/^\/(?:documents|issues|projects|programs|sprints)\/([^/?#]+)/);
  return match?.[1] ?? null;
}

function getCurrentContextKind(pathname: string): FleetGraphChatContext['kind'] {
  if (pathname.startsWith('/issues/')) return 'issue';
  if (pathname.startsWith('/projects/')) return 'project';
  if (pathname.startsWith('/programs/')) return 'program';
  if (pathname.startsWith('/sprints/')) return 'sprint';
  return 'document';
}

function sourcePathForDocumentId(documentId: string | null): string | undefined {
  return documentId ? `/documents/${documentId}` : undefined;
}

function contextMatchesSource(item: ChatContextItem, sourcePath: string | undefined): boolean {
  return Boolean(sourcePath && item.sourcePath === sourcePath);
}

function dedupeContextItems(items: ChatContextItem[]): ChatContextItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = item.sourcePath || item.id;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function displayText(value: string): string {
  return value.replace(/\bFleetGraph\b/g, 'Ship');
}

function compactBlockerText(value: string): string {
  const text = value.trim();
  return text
    .replace(/^blocked\s+(?:but|because|on|by|for|until|while)\s+/i, '')
    .replace(/^blocked[:\s-]+/i, '')
    .replace(/^latest blocker[:\s-]+/i, '')
    .replace(/^./, (letter) => letter.toUpperCase());
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
  const [chatTurns, setChatTurns] = useState<ChatTurn[]>([]);
  const [expanded, setExpanded] = useState(false);
  const nextTurnIdRef = useRef(1);
  const chatTurnsRef = useRef<ChatTurn[]>([]);

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
    chatTurnsRef.current = chatTurns;
  }, [chatTurns]);

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
    setChatTurns([]);
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
    setChatTurns([]);
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

  const chatContext = (): FleetGraphChatContext | null => {
    const attachedContexts = contextItems
      .filter((item) => (item.attached || item.notification) && !contextMatchesSource(item, currentSourcePath))
      .map((item) => item.context);
    if (activeNotification?.findingId) {
      return {
        kind: 'notification',
        findingId: activeNotification.findingId,
        sourcePath: activeNotification.sourcePath,
        ...(pageContext ? { pageContext } : {}),
        ...(attachedContexts.length > 0 ? { attachedContexts } : {}),
      };
    }
    if (currentDocumentId) {
      return {
        kind: currentContextKind,
        documentId: currentDocumentId,
        sourcePath: currentSourcePath,
        ...(pageContext ? { pageContext } : {}),
        ...(attachedContexts.length > 0 ? { attachedContexts } : {}),
      };
    }
    if (pageContext) {
      return {
        kind: 'workspace',
        sourcePath: pageContext.route,
        pageContext,
        ...(attachedContexts.length > 0 ? { attachedContexts } : {}),
      };
    }
    return null;
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const prompt = draft.trim();
    if (!prompt) return;

    const context = chatContext();
    const turnId = nextTurnIdRef.current;
    nextTurnIdRef.current += 1;
    const historySource = chatTurnsRef.current;
    setDraft('');
    setChatTurns((turns) => {
      const nextTurns = [...turns, { id: turnId, prompt, status: 'loading' } satisfies ChatTurn];
      chatTurnsRef.current = nextTurns;
      return nextTurns;
    });

    if (!context) {
      setChatTurns((turns) => turns.map((turn) => turn.id === turnId
        ? {
            ...turn,
            status: 'ready',
            response: {
              decision: 'quiet_exit',
              answer: {
                title: 'Open a source first',
                body: 'Open an issue, scoped list, week, project, program, document, or notification before asking.',
                sources: [],
                humanGate: { required: false },
              },
            },
          }
        : turn));
      return;
    }

    try {
      const history = historySource.flatMap<FleetGraphChatHistoryEntry>((turn) => {
        const entries: FleetGraphChatHistoryEntry[] = [{ role: 'user', content: turn.prompt }];
        if (turn.status === 'ready' && turn.response?.answer.body) {
          entries.push({ role: 'assistant', content: turn.response.answer.body });
        }
        return entries;
      }).slice(-FLEETGRAPH_CHAT_HISTORY_LIMIT);
      const response = await apiPostJson<FleetGraphChatResponse>(
        '/api/fleetgraph/chat',
        { prompt, context, ...(history.length > 0 ? { history } : {}) },
        'Failed to ask Ship'
      );
      setChatTurns((turns) => turns.map((turn) => turn.id === turnId
        ? { ...turn, status: 'ready', response }
        : turn));
    } catch (error) {
      const status = getApiErrorStatus(error);
      setChatTurns((turns) => turns.map((turn) => turn.id === turnId
        ? { ...turn, status: 'error', errorMessage: chatErrorMessage(status) }
        : turn));
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

function ContextPopover({
  popoverRef,
  surfaceLabel,
  contextItems,
  onActivateContext,
  onRemoveContext,
}: {
  popoverRef: RefObject<HTMLDivElement>;
  surfaceLabel: string;
  contextItems: ChatContextItem[];
  onActivateContext: (id: string) => void;
  onRemoveContext: (id: string) => void;
}) {
  return (
    <div ref={popoverRef} className="absolute right-10 top-[calc(100%-4px)] z-10 w-[280px] rounded-lg border border-border bg-[#111111] p-2 shadow-xl shadow-black/40">
      <div className="scrollbar-hide max-h-56 space-y-1 overflow-y-auto">
        <div className="rounded px-2 py-1.5 text-xs text-muted">
          {displayText(`${surfaceLabel} - Untitled`)}
        </div>
        {contextItems.map((item) => (
          <div key={item.id} className="flex w-full items-center rounded border border-transparent text-xs text-muted transition hover:border-border">
            <button
              type="button"
              onClick={() => onActivateContext(item.id)}
              className="min-w-0 flex-1 px-2 py-1.5 text-left transition hover:text-foreground focus:outline-none focus:ring-2 focus:ring-accent"
            >
              <span className="block truncate">{displayText(item.label)}</span>
            </button>
            <button
              type="button"
              onClick={() => onRemoveContext(item.id)}
              className="px-2 py-1.5 text-xs text-muted transition hover:text-foreground focus:outline-none focus:ring-2 focus:ring-accent"
              aria-label={`Remove ${displayText(item.label)} from context`}
            >
              x
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function CurrentContextChip({ title }: { title: string }) {
  return (
    <span className="flex max-w-[calc((100%-2.75rem)/2)] shrink-0 items-center gap-1.5 rounded border border-border bg-background px-1.5 py-0.5 text-[11px] leading-4 text-muted">
      <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full border border-emerald-400" />
      <span className="truncate">{displayText(title)}</span>
    </span>
  );
}

function EmptyConversation({ surfaceLabel }: { surfaceLabel: string }) {
  return (
    <div className="flex flex-1 items-center justify-center px-4 text-center">
      <div className="flex max-w-[280px] flex-col items-center gap-4">
        <p className="text-sm leading-6 text-muted">
          Ask about this {surfaceLabel.toLowerCase()}.
        </p>
      </div>
    </div>
  );
}

function NotificationConversation({
  notification,
  explanation,
}: {
  notification: FleetGraphNotificationProbeItem;
  explanation: ExplanationState;
}) {
  const ownerLabel = notification.owner || '-';
  const output = explanation.status === 'ready' ? explanation.output : null;
  const sourceLabels = sourceLabelsForConversation(notification, output);
  const recommendedAction = recommendedActionText(output);
  const humanGateRequired = output ? output.humanGate.required === true : true;
  const primaryText = conversationBody(notification, output);
  const isLoading = explanation.status === 'loading';
  const isFallback = !output && explanation.status === 'error';
  const showNextStep = !isLoading && Boolean(recommendedAction || humanGateRequired);

  const nextStep = recommendedAction || 'Ask the connected owner to confirm the unblocker and the next handoff.';
  const gateText = humanGateRequired
    ? 'Human approval is required before Ship state changes or any message is sent.'
    : '';

  return (
    <div className="flex w-full flex-col gap-3">
      <UserMessage>What's going on here?</UserMessage>

      <AssistantAnswer
        eyebrow={displayText(titleWithoutSignalPrefix(notification.title, notification.signalLabel))}
        body={isLoading ? 'Checking the graph explanation for this finding...' : primaryText}
        metadata={[ownerLabel, displayText(notification.context), notification.age, ...(isFallback ? ['fallback'] : [])]}
        sources={sourceLabels}
        signalLabel={notification.signalLabel}
        signalType={notification.signalType}
      />

      {showNextStep && (
        <NextStepCard text={nextStep} gateText={gateText} />
      )}
    </div>
  );
}

function ChatTurnList({ turns }: { turns: ChatTurn[] }) {
  return (
    <>
      {turns.map((turn) => {
        return (
          <div key={turn.id} className="flex w-full flex-col gap-3">
            <UserMessage>{turn.prompt}</UserMessage>
            {turn.status === 'loading' && (
              <AssistantThinking />
            )}
            {turn.status === 'error' && (
              <AssistantAnswer
                eyebrow="Chat unavailable"
                body={turn.errorMessage || 'Ship could not reach the chat service.'}
                metadata={[]}
                sources={[]}
              />
            )}
            {turn.status === 'ready' && turn.response && (
              <>
                <AssistantAnswer
                  eyebrow={undefined}
                  body={turn.response.answer.body}
                  metadata={[]}
                  sources={[]}
                />
                {(turn.response.answer.nextStep || turn.response.answer.humanGate.required === true) && (
                  <InlineGateNote
                    text={turn.response.answer.nextStep || 'A human must approve the next action before Ship changes anything.'}
                    gateText={turn.response.answer.humanGate.required === true
                      ? 'Approval required before Ship changes anything or sends a message.'
                      : ''}
                  />
                )}
              </>
            )}
          </div>
        );
      })}
    </>
  );
}

function UserMessage({ children }: { children: string }) {
  return (
    <div className="self-end rounded-lg bg-accent px-3.5 py-2.5 text-sm leading-5 text-white" data-testid="chat-user-message">
      {children}
    </div>
  );
}

function AssistantThinking() {
  return (
    <div className="w-full text-sm leading-5 text-muted">
      Thinking...
    </div>
  );
}

function chatErrorMessage(status: number | undefined): string {
  if (status === 401) return 'Your session expired. Refresh and sign in again.';
  if (status === 403) return 'Chat was rejected by the API. Refresh the page and try again.';
  if (status === 404) return 'Ship could not find visible context for this chat.';
  if (status === 429) return 'Chat is rate limited. Try again in a minute.';
  if (status && status >= 500) return 'The Ship API is unavailable right now.';
  return 'Ship could not reach the chat service.';
}

function AssistantAnswer({
  eyebrow,
  body,
  metadata,
  sources,
  signalLabel,
  signalType = 'blocked',
}: {
  eyebrow?: string;
  body: string;
  metadata: string[];
  sources: string[];
  signalLabel?: string;
  signalType?: FleetGraphNotificationProbeItem['signalType'];
}) {
  const metadataItems = metadata.filter((item) => item && item !== '-');

  return (
    <div className="w-full text-foreground" data-testid="chat-assistant-message">
      {eyebrow && (
        <p className="mb-1 truncate text-[11px] leading-4 text-muted">{displayText(eyebrow)}</p>
      )}
      {signalLabel ? (
        <p className="text-base leading-6">
          <span className="mr-2 inline-flex align-[2px]">
            <NotificationLabelChip label={signalLabel} signalType={signalType} />
          </span>
          {displayText(body)}
        </p>
      ) : (
        <MarkdownMessage text={displayText(body)} />
      )}
      <InlineProvenance metadata={metadataItems} sources={sources} />
    </div>
  );
}

function MarkdownMessage({ text }: { text: string }) {
  return (
    <div className="text-base leading-6 text-foreground">
      <ReactMarkdown
        components={{
          p: ({ children }) => <p className="mb-3 last:mb-0">{children}</p>,
          ul: ({ children }) => <ul className="mb-3 ml-5 list-disc space-y-1 last:mb-0">{children}</ul>,
          ol: ({ children }) => <ol className="mb-3 ml-5 list-decimal space-y-1 last:mb-0">{children}</ol>,
          li: ({ children }) => <li className="pl-1">{children}</li>,
          code: ({ className, children }) => {
            const isBlock = Boolean(className);
            return isBlock
              ? <code className={className}>{children}</code>
              : <code className="rounded border border-border bg-background px-1 py-0.5 text-[0.9em] text-foreground">{children}</code>;
          },
          pre: ({ children }) => (
            <pre className="mb-3 overflow-x-auto rounded-md border border-border bg-background p-3 text-sm leading-5 text-foreground last:mb-0">
              {children}
            </pre>
          ),
          strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
          a: ({ children, href }) => (
            <a href={href} className="text-accent underline underline-offset-2" target="_blank" rel="noreferrer">
              {children}
            </a>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

function InlineProvenance({ metadata, sources }: { metadata: string[]; sources: string[] }) {
  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] leading-4 text-muted">
      {metadata.map((item, index) => (
        <span key={`${item}-${index}`} className="inline-flex items-center gap-1.5">
          {index > 0 && <span aria-hidden="true">·</span>}
          <span>{displayText(item)}</span>
        </span>
      ))}
      {sources.length > 0 && (
        <>
          {metadata.length > 0 && <span aria-hidden="true" className="text-muted/60">/</span>}
          {sources.map((label, index) => (
            <span key={label} className="inline-flex items-center gap-1">
              {index > 0 && <span aria-hidden="true">·</span>}
              <button type="button" className="hover:text-foreground">{displayText(label)}</button>
            </span>
          ))}
        </>
      )}
    </div>
  );
}

function InlineGateNote({ text, gateText, label = 'Next:' }: { text: string; gateText?: string; label?: string }) {
  return (
    <p className="text-[13px] leading-5 text-muted">
      <span className="text-foreground">{label}</span> {displayText(text)} {gateText && (
        <span className="text-muted/70">{gateText}</span>
      )}
    </p>
  );
}

function NextStepCard({ text, gateText }: { text: string; gateText?: string }) {
  return (
    <div className="w-full rounded-lg border border-border bg-background/60 p-3">
      <p className="text-xs font-medium text-foreground">Possible next step</p>
      <p className="mt-1 text-sm leading-5 text-muted">{displayText(text)}</p>
      {gateText && (
        <p className="mt-1 text-[13px] leading-[18px] text-muted">{gateText}</p>
      )}
    </div>
  );
}

function sourceLabelsForConversation(
  notification: FleetGraphNotificationProbeItem,
  output: FleetGraphVisibleOutput | null
): string[] {
  const labels = output?.evidence
    .filter((item) => item.visibility === 'actor_visible')
    .map((item) => sourceLabelForEvidence(item))
    .filter((label): label is string => Boolean(label))
    ?? [notification.context, notification.owner || '-'];

  return labels.filter((label, index) => label !== '-' && labels.indexOf(label) === index);
}

function sourceLabelForEvidence(item: FleetGraphEvidence): string | null {
  if (item.kind === 'blocker') return null;
  if (item.kind === 'source_issue') return 'Source issue';
  if (item.kind === 'source_sprint') return 'Week';
  if (item.kind === 'finding') return 'Finding';
  return item.claim || null;
}

function conversationBody(
  notification: FleetGraphNotificationProbeItem,
  output: FleetGraphVisibleOutput | null
): string {
  if (notification.signalType !== 'blocked') {
    return notification.notificationText || notification.reason || output?.summary || 'This work needs attention.';
  }
  return blockerExcerpt(output)
    ? compactBlockerText(blockerExcerpt(output) ?? '')
    : notification.notificationText || notification.blockerText
      ? compactBlockerText(notification.notificationText || notification.blockerText)
      : output?.summary
    || 'No blocker reason was recorded.';
}

function titleWithoutSignalPrefix(title: string, signalLabel: string): string {
  const prefix = `${signalLabel}:`;
  return title.toLowerCase().startsWith(prefix.toLowerCase())
    ? title.slice(prefix.length).trim()
    : title;
}

function blockerExcerpt(output: FleetGraphVisibleOutput | null): string | null {
  const excerpt = output?.evidence.find((item) => item.kind === 'blocker' && item.excerpt?.trim())?.excerpt;
  return excerpt?.trim() || null;
}

function recommendedActionText(output: FleetGraphVisibleOutput | null): string | null {
  if (!output?.recommendedAction) return null;
  return output.recommendedAction.text
    || output.recommendedAction.summary
    || output.recommendedAction.label
    || null;
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

function ClearIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 6h18M8 6V4h8v2M10 11v6M14 11v6M6 6l1 14h10l1-14" />
    </svg>
  );
}

function ExpandIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M8 3H3v5M16 3h5v5M21 16v5h-5M3 16v5h5M3 3l7 7M21 3l-7 7M21 21l-7-7M3 21l7-7" />
    </svg>
  );
}

function ShrinkIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M10 3v7H3M14 3v7h7M21 14h-7v7M10 21v-7H3M3 10l7-7M21 10l-7-7M14 21l7-7M10 14l-7 7" />
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
