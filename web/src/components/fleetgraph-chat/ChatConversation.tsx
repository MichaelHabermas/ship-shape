import ReactMarkdown from 'react-markdown';
import type { RefObject } from 'react';
import type { FleetGraphNotificationProbeItem } from '@/components/FleetGraphNotificationsProbe';
import { NotificationLabelChip } from '@/components/NotificationLabelChip';
import type { FleetGraphChatTurn } from '@/hooks/useFleetGraphChatTurns';
import {
  conversationBody,
  displayText,
  recommendedActionText,
  sourceLabelsForConversation,
  titleWithoutSignalPrefix,
  type ChatContextItem,
  type ExplanationState,
} from '@/components/fleetgraph-chat/chat-probe-utils';

export function CurrentContextChip({ title }: { title: string }) {
  return (
    <span className="flex max-w-[calc((100%-2.75rem)/2)] shrink-0 items-center gap-1.5 rounded border border-border bg-background px-1.5 py-0.5 text-[11px] leading-4 text-muted">
      <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full border border-emerald-400" />
      <span className="truncate">{displayText(title)}</span>
    </span>
  );
}

export function ContextPopover({
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

export function EmptyConversation({ surfaceLabel }: { surfaceLabel: string }) {
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

export function NotificationConversation({
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

export function ChatTurnList({ turns }: { turns: FleetGraphChatTurn[] }) {
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
