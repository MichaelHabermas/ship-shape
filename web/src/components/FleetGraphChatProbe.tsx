import { useMemo, useState, type ChangeEvent } from 'react';
import { useLocation } from 'react-router-dom';

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
          <header className="flex items-center justify-between border-b border-border px-4 py-3">
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-2 text-xs text-muted">
                <span className="truncate">{surfaceLabel}</span>
                <span aria-hidden="true" className="h-1 w-1 rounded-full bg-muted/60" />
                <span className="truncate">Untitled</span>
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
          </header>

          <div className="flex flex-1 items-center justify-center px-8 text-center">
            <div className="flex max-w-[280px] flex-col items-center gap-4">
              <p className="text-sm leading-6 text-muted">
                Ask about this document.
              </p>
              <div className="flex flex-wrap justify-center gap-2">
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
            </div>
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
