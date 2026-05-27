import { useMemo, useState, type ChangeEvent } from 'react';
import { useLocation } from 'react-router-dom';

const showSampleConversation = true;

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

export function FleetGraphChatProbe() {
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const surfaceLabel = useMemo(() => getSurfaceLabel(location.pathname), [location.pathname]);

  const handleDraftChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    setDraft(event.target.value);
    event.target.style.height = '0px';
    event.target.style.height = `${Math.min(event.target.scrollHeight, 120)}px`;
    event.target.style.overflowY = event.target.scrollHeight > 120 ? 'auto' : 'hidden';
  };

  return (
    <div className="fixed bottom-5 right-5 z-40 flex flex-col items-end gap-3">
      {open && (
        <section
          aria-label="Context chat"
          className="flex h-[min(620px,calc(100vh-7rem))] w-[min(420px,calc(100vw-2.5rem))] flex-col overflow-hidden rounded-lg border border-border bg-[#111111] shadow-2xl shadow-black/40"
        >
          <header className="relative flex items-center justify-between border-b border-border px-3.5 py-2.5">
            <div className="min-w-0 pr-2">
              <div className="flex max-h-12 min-w-0 flex-wrap gap-x-1.5 gap-y-1 overflow-hidden">
                <span className="shrink-0 rounded border border-border bg-background px-1.5 py-0.5 text-[11px] leading-4 text-muted">
                  {surfaceLabel} - Untitled
                </span>
                <button
                  type="button"
                  className="flex shrink-0 items-center gap-1 rounded border border-border bg-background px-1.5 py-0.5 text-[11px] leading-4 text-muted transition hover:border-[#3a3a3a] hover:text-foreground"
                >
                  API access blocker
                  <span aria-hidden="true" className="text-xs leading-none text-muted">x</span>
                </button>
                <button
                  type="button"
                  className="flex shrink-0 items-center gap-1 rounded border border-border bg-background px-1.5 py-0.5 text-[11px] leading-4 text-muted transition hover:border-[#3a3a3a] hover:text-foreground"
                >
                  Project Delta
                  <span aria-hidden="true" className="text-xs leading-none text-muted">x</span>
                </button>
                <button
                  type="button"
                  className="flex shrink-0 items-center gap-1 rounded border border-border bg-background px-1.5 py-0.5 text-[11px] leading-4 text-muted transition hover:border-[#3a3a3a] hover:text-foreground"
                >
                  Sprint 12
                  <span aria-hidden="true" className="text-xs leading-none text-muted">x</span>
                </button>
                <button
                  type="button"
                  className="flex shrink-0 items-center gap-1 rounded border border-border bg-background px-1.5 py-0.5 text-[11px] leading-4 text-muted transition hover:border-[#3a3a3a] hover:text-foreground"
                >
                  Dev User
                  <span aria-hidden="true" className="text-xs leading-none text-muted">x</span>
                </button>
                <button
                  type="button"
                  className="flex shrink-0 items-center gap-1 rounded border border-border bg-background px-1.5 py-0.5 text-[11px] leading-4 text-muted transition hover:border-[#3a3a3a] hover:text-foreground"
                >
                  Auth rollout
                  <span aria-hidden="true" className="text-xs leading-none text-muted">x</span>
                </button>
                <button
                  type="button"
                  onClick={() => setContextOpen((value) => !value)}
                  className="shrink-0 rounded border border-border bg-[#171717] px-1.5 py-0.5 text-[11px] leading-4 text-foreground transition hover:border-[#3a3a3a] hover:bg-white/5"
                  aria-expanded={contextOpen}
                >
                  +8
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

            {contextOpen && <ContextPopover />}
          </header>

          <div className="scrollbar-hide flex flex-1 overflow-y-auto px-4 py-5">
            {showSampleConversation ? <SampleConversation /> : <EmptyConversation />}
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

function ContextPopover() {
  return (
    <div className="absolute right-10 top-[calc(100%-4px)] z-10 w-[280px] rounded-lg border border-border bg-[#111111] p-2 shadow-xl shadow-black/40">
      <div className="scrollbar-hide max-h-56 space-y-1 overflow-y-auto">
        <div className="rounded px-2 py-1.5 text-xs text-muted">
          Current - Untitled
        </div>
        {[
          'API access blocker',
          'Project Delta',
          'Sprint 12',
          'Dev User',
          'Auth rollout',
          'Backend queue',
          'Contract review',
          'Standup note',
          'Release risk',
          'PM thread',
          'Security review',
          'API logs',
          'Access request',
          'Customer note',
        ].map((label) => (
          <button
            type="button"
            key={label}
            className="flex w-full items-center justify-between rounded border border-transparent px-2 py-1.5 text-left text-xs text-muted transition hover:border-border hover:text-foreground"
          >
            <span>{label}</span>
            <span aria-hidden="true" className="text-xs text-muted">x</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function EmptyConversation() {
  return (
    <div className="flex flex-1 items-center justify-center px-4 text-center">
      <div className="flex max-w-[280px] flex-col items-center gap-4">
        <p className="text-sm leading-6 text-muted">
          Ask about this document.
        </p>
        <PromptChips />
      </div>
    </div>
  );
}

function SampleConversation() {
  return (
    <div className="flex w-full flex-col gap-5">
      <div className="self-end rounded-lg bg-accent px-3.5 py-2.5 text-sm leading-5 text-white">
        Why is this blocked?
      </div>

      <div className="max-w-[330px] text-sm leading-6 text-foreground">
        <p className="mb-2 text-xs text-muted">Looking at Untitled</p>
        <p>
          The document points to a stalled handoff, but there is not enough here to say who owns the unblock yet.
        </p>
        <p className="mt-3 text-muted">
          I would check the latest issue update and the linked project owner before nudging anyone.
        </p>
      </div>

      <div className="max-w-[330px] rounded-lg border border-border bg-background/60 p-3">
        <p className="text-xs font-medium text-foreground">Possible next step</p>
        <p className="mt-1 text-sm leading-5 text-muted">
          Ask the project owner for the latest unblocker.
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

      <div className="max-w-[330px] text-sm leading-6 text-foreground">
        <p>
          The status moved from active work to blocked after the latest update. The blocker text mentions waiting on API access, but the document itself has not been updated with a named owner.
        </p>
        <p className="mt-3 text-muted">
          That makes this feel less like engineering discovery and more like a coordination gap.
        </p>
      </div>

      <div className="self-end rounded-lg bg-accent px-3.5 py-2.5 text-sm leading-5 text-white">
        Who should I ask?
      </div>

      <div className="max-w-[330px] text-sm leading-6 text-foreground">
        <p>
          Start with the project owner. If they do not know who controls the access request, then route to the program owner.
        </p>
        <p className="mt-3 text-muted">
          I would avoid broadcasting this to the whole workspace until the owner path is exhausted.
        </p>
      </div>

      <div className="max-w-[330px] rounded-lg border border-border bg-background/60 p-3">
        <p className="text-xs font-medium text-foreground">Draft nudge</p>
        <p className="mt-1 text-sm leading-5 text-muted">
          Can you confirm who owns the API access unblocker for this work?
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
