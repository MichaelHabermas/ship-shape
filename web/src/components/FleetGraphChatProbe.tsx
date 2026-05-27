import { useMemo, useState } from 'react';
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

  return (
    <div className="fixed bottom-5 right-5 z-40 flex flex-col items-end gap-3">
      {open && (
        <section
          aria-label="FleetGraph chat"
          className="flex h-[min(620px,calc(100vh-7rem))] w-[min(420px,calc(100vw-2.5rem))] flex-col overflow-hidden rounded-lg border border-border bg-[#111111] shadow-2xl shadow-black/40"
        >
          <header className="flex items-center justify-between border-b border-border px-4 py-3">
            <div className="min-w-0">
              <div className="text-sm font-medium text-foreground">FleetGraph</div>
              <div className="truncate text-xs text-muted">{surfaceLabel}</div>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="ml-3 flex h-8 w-8 items-center justify-center rounded-md text-muted transition hover:bg-white/5 hover:text-foreground focus:outline-none focus:ring-2 focus:ring-accent"
              aria-label="Close FleetGraph"
            >
              <CloseIcon />
            </button>
          </header>

          <div className="flex flex-1 items-center justify-center px-8 text-center">
            <p className="max-w-[260px] text-sm leading-6 text-muted">
              No conversation yet.
            </p>
          </div>

          <form className="border-t border-border p-3" onSubmit={(event) => event.preventDefault()}>
            <label className="sr-only" htmlFor="fleetgraph-chat-draft">Message FleetGraph</label>
            <div className="flex items-end gap-2 rounded-lg border border-border bg-background p-2 focus-within:border-accent">
              <textarea
                id="fleetgraph-chat-draft"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                rows={1}
                placeholder="Ask about this..."
                className="max-h-32 min-h-9 flex-1 resize-none bg-transparent px-1 py-2 text-sm text-foreground outline-none placeholder:text-muted"
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
        aria-label={open ? 'Hide FleetGraph' : 'Open FleetGraph'}
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
