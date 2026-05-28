// Renders contextual FleetGraph chat for source-aware page and notification discussion.
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent, type RefObject } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import type {
  FleetGraphChatContext,
  FleetGraphChatResponse,
  FleetGraphEvidence,
  FleetGraphRunResponse,
  FleetGraphVisibleOutput,
} from '@/api/schemas';
import type { FleetGraphNotificationProbeItem } from '@/components/FleetGraphNotificationsProbe';
import { NotificationLabelChip } from '@/components/NotificationLabelChip';
import { apiGetJson, apiPostJson } from '@/lib/api';

interface ChatContextItem {
  id: string;
  label: string;
  sourcePath?: string;
  notification?: FleetGraphNotificationProbeItem;
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
  if (!pathname.startsWith('/documents/')) return null;
  return pathname.split('/documents/')[1]?.split(/[/?#]/)[0] || null;
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

export function FleetGraphChatProbe({ discussRequest }: { discussRequest: FleetGraphChatProbeRequest | null }) {
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
  const [nextTurnId, setNextTurnId] = useState(1);

  const surfaceLabel = useMemo(() => getSurfaceLabel(location.pathname), [location.pathname]);
  const currentDocumentId = useMemo(() => getCurrentDocumentId(location.pathname), [location.pathname]);
  const currentSourcePath = useMemo(() => sourcePathForDocumentId(currentDocumentId), [currentDocumentId]);
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
    setContextItems((items) => items.filter((item) => !contextMatchesSource(item, currentSourcePath)));
  }, [currentSourcePath]);

  useEffect(() => {
    if (!discussRequest) return;

    const notification = discussRequest.notification;
    setOpen(true);
    setActiveNotification(notification);
    setExplanation(notification.findingId ? { status: 'loading', findingId: notification.findingId } : { status: 'idle' });
    setContextItems((items) => {
      const contextItem: ChatContextItem = {
        id: `notification:${notification.id}`,
        label: displayText(notification.title),
        sourcePath: notification.sourcePath,
        notification,
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
    setContextOpen(false);
  };

  const handleDraftChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    setDraft(event.target.value);
    event.target.style.height = '0px';
    event.target.style.height = `${Math.min(event.target.scrollHeight, 120)}px`;
    event.target.style.overflowY = event.target.scrollHeight > 120 ? 'auto' : 'hidden';
  };

  const chatContext = (): FleetGraphChatContext | null => {
    if (activeNotification?.findingId) {
      return {
        kind: 'notification',
        findingId: activeNotification.findingId,
        sourcePath: activeNotification.sourcePath,
      };
    }
    if (currentDocumentId) {
      return {
        kind: 'document',
        documentId: currentDocumentId,
        sourcePath: currentSourcePath,
      };
    }
    return null;
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const prompt = draft.trim();
    if (!prompt) return;

    const context = chatContext();
    const turnId = nextTurnId;
    setNextTurnId((value) => value + 1);
    setDraft('');
    setChatTurns((turns) => [...turns, { id: turnId, prompt, status: 'loading' }]);

    if (!context) {
      setChatTurns((turns) => turns.map((turn) => turn.id === turnId
        ? {
            ...turn,
            status: 'ready',
            response: {
              decision: 'quiet_exit',
              answer: {
                title: 'Open a source first',
                body: 'Open an issue, week, project, program, document, or notification before asking.',
                sources: [],
                humanGate: { required: false },
              },
            },
          }
        : turn));
      return;
    }

    try {
      const response = await apiPostJson<FleetGraphChatResponse>(
        '/api/fleetgraph/chat',
        { prompt, context },
        'Failed to ask FleetGraph'
      );
      setChatTurns((turns) => turns.map((turn) => turn.id === turnId
        ? { ...turn, status: 'ready', response }
        : turn));
    } catch {
      setChatTurns((turns) => turns.map((turn) => turn.id === turnId
        ? { ...turn, status: 'error' }
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
          className="flex h-[min(620px,calc(100vh-7rem))] w-[min(420px,calc(100vw-2.5rem))] flex-col overflow-hidden rounded-lg border border-border bg-[#111111] shadow-2xl shadow-black/40"
        >
          <header className="relative flex items-center justify-between border-b border-border px-3.5 pb-2.5 pt-2">
            <div className="min-w-0 flex-1 pr-2">
              <div className="flex max-h-[52px] min-w-0 flex-wrap gap-1.5 overflow-hidden">
                <CurrentContextChip title={currentTitle} />
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
                rows={1}
                placeholder={activeNotification ? 'Ask about this signal...' : `Ask about this ${surfaceLabel.toLowerCase()}...`}
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

  const nextStep = recommendedAction || 'Ask the connected owner to confirm the unblocker and the next handoff.';
  const gateText = humanGateRequired
    ? 'Human approval is required before Ship state changes or any message is sent.'
    : 'No approval gate is required for this explanation.';

  return (
    <div className="flex w-full flex-col gap-3">
      <UserMessage>What's going on here?</UserMessage>

      <AssistantAnswer
        eyebrow={displayText(titleWithoutSignalPrefix(notification.title, notification.signalLabel))}
        body={isLoading ? 'Checking the graph explanation for this finding...' : primaryText}
        metadata={[ownerLabel, displayText(notification.context), notification.age, ...(isFallback ? ['fallback'] : [])]}
        sources={sourceLabels}
        signalLabel={notification.signalLabel}
      />

      <InlineGateNote text={nextStep} gateText={gateText} />
    </div>
  );
}

function ChatTurnList({ turns }: { turns: ChatTurn[] }) {
  return (
    <>
      {turns.map((turn) => (
        <div key={turn.id} className="flex w-full flex-col gap-3">
          <UserMessage>{turn.prompt}</UserMessage>
          {turn.status === 'loading' && (
            <AssistantAnswer
              eyebrow="Checking"
              body="Checking current Ship context..."
              metadata={[]}
              sources={[]}
            />
          )}
          {turn.status === 'error' && (
            <AssistantAnswer
              eyebrow="No answer"
              body="I could not answer from the current context."
              metadata={['error']}
              sources={[]}
            />
          )}
          {turn.status === 'ready' && turn.response && (
            <>
              <AssistantAnswer
                eyebrow={turn.response.answer.title}
                body={turn.response.answer.body}
                metadata={[turn.response.decision]}
                sources={turn.response.answer.sources.map((source) => source.label)}
              />
              {(turn.response.answer.nextStep || turn.response.answer.humanGate.required === true) && (
                <InlineGateNote
                  text={turn.response.answer.nextStep || 'A human must approve the next action before Ship changes anything.'}
                  gateText={turn.response.answer.humanGate.required === true
                    ? 'Approval required before Ship changes anything or sends a message.'
                    : 'No approval gate is required for this answer.'}
                />
              )}
            </>
          )}
        </div>
      ))}
    </>
  );
}

function UserMessage({ children }: { children: string }) {
  return (
    <div className="self-end rounded-lg bg-accent px-3.5 py-2.5 text-sm leading-5 text-white">
      {children}
    </div>
  );
}

function AssistantAnswer({
  eyebrow,
  body,
  metadata,
  sources,
  signalLabel,
}: {
  eyebrow: string;
  body: string;
  metadata: string[];
  sources: string[];
  signalLabel?: string;
}) {
  const metadataItems = metadata.filter((item) => item && item !== '-');

  return (
    <div className="w-full text-foreground">
      <p className="mb-1 truncate text-[11px] leading-4 text-muted">{displayText(eyebrow)}</p>
      <p className="text-base leading-6">
        {signalLabel && (
          <span className="mr-2 inline-flex align-[2px]">
            <NotificationLabelChip label={signalLabel} />
          </span>
        )}
        {displayText(body)}
      </p>
      <InlineProvenance metadata={metadataItems} sources={sources} />
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

function InlineGateNote({ text, gateText }: { text: string; gateText: string }) {
  return (
    <p className="text-[13px] leading-5 text-muted">
      <span className="text-foreground">Next:</span> {displayText(text)} <span className="text-muted/70">{gateText}</span>
    </p>
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

function SendIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="m4 12 16-8-5 16-3-7-8-1Z" />
    </svg>
  );
}
