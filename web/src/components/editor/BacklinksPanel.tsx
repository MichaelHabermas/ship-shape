import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiClient, assertApiData } from '@/api/client';
import type { components } from '@/api/generated/ship-openapi';
import { ContextMenu, ContextMenuItem } from '@/components/ui/ContextMenu';
import { useToast } from '@/components/ui/Toast';
import { cn } from '@/lib/cn';

const POLL_INTERVAL_MS = 5000;
const ERROR_RETRY_MS = 15000;

type Backlink = components['schemas']['Backlink'];

interface BacklinksPanelProps {
  documentId: string;
}

export function BacklinksPanel({ documentId }: BacklinksPanelProps) {
  const [backlinks, setBacklinks] = useState<Backlink[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<'ready' | 'stale' | 'offline'>('ready');
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; backlink: Backlink } | null>(null);
  const navigate = useNavigate();
  const { showToast } = useToast();

  useEffect(() => {
    setBacklinks([]);
    setContextMenu(null);
    setStatus('ready');

    if (!documentId) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let hasLoadedSuccessfully = false;
    let lastLoggedError = '';
    setLoading(true);

    const clearRetryTimer = () => {
      if (retryTimer) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
    };

    const logFetchErrorOnce = (err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      if (message === lastLoggedError) return;
      lastLoggedError = message;
      console.error('Error fetching backlinks:', err);
    };

    const scheduleNextFetch = (delay: number) => {
      clearRetryTimer();
      if (!cancelled) {
        retryTimer = setTimeout(fetchBacklinks, delay);
      }
    };

    async function fetchBacklinks() {
      clearRetryTimer();

      if (!navigator.onLine) {
        if (!cancelled) {
          setLoading(false);
          setStatus('offline');
        }
        return;
      }

      try {
        if (!hasLoadedSuccessfully) {
          setLoading(true);
        }

        const response = await apiClient.GET('/documents/{id}/backlinks', {
          params: { path: { id: documentId } },
        });

        if (response.error) {
          throw new Error('Failed to fetch backlinks');
        }

        const data = assertApiData(response, 'Failed to fetch backlinks');

        if (!cancelled) {
          setBacklinks(data);
          hasLoadedSuccessfully = true;
          lastLoggedError = '';
          if (navigator.onLine) {
            setStatus('ready');
            scheduleNextFetch(POLL_INTERVAL_MS);
          } else {
            setStatus('offline');
          }
        }
      } catch (err) {
        if (!cancelled) {
          logFetchErrorOnce(err);
          setStatus(navigator.onLine ? 'stale' : 'offline');
          if (navigator.onLine) {
            scheduleNextFetch(ERROR_RETRY_MS);
          }
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    const handleOnline = () => {
      if (!cancelled) {
        fetchBacklinks();
      }
    };

    const handleOffline = () => {
      clearRetryTimer();
      if (!cancelled) {
        setLoading(false);
        setStatus('offline');
      }
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    fetchBacklinks();

    return () => {
      cancelled = true;
      clearRetryTimer();
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [documentId]);

  const getDocumentUrl = (backlink: Backlink): string => {
    // Get the path based on document type
    switch (backlink.document_type) {
      case 'issue':
        return `/issues/${backlink.id}`;
      case 'wiki':
        return `/docs/${backlink.id}`;
      case 'program':
        return `/programs/${backlink.id}`;
      case 'sprint':
        return `/sprints/${backlink.id}`;
      case 'person':
        return `/team/${backlink.id}`;
      case 'weekly_plan':
      case 'weekly_retro':
        return `/docs/${backlink.id}`;
      default:
        return `/docs/${backlink.id}`;
    }
  };

  const handleNavigate = (backlink: Backlink) => {
    navigate(getDocumentUrl(backlink));
  };

  const handleContextMenu = useCallback((e: React.MouseEvent, backlink: Backlink) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, backlink });
  }, []);

  const handleMenuClick = useCallback((e: React.MouseEvent, backlink: Backlink) => {
    e.preventDefault();
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    setContextMenu({ x: rect.right, y: rect.bottom, backlink });
  }, []);

  const handleOpen = useCallback(() => {
    if (contextMenu) {
      navigate(getDocumentUrl(contextMenu.backlink));
      setContextMenu(null);
    }
  }, [contextMenu, navigate]);

  const handleOpenInNewTab = useCallback(() => {
    if (contextMenu) {
      const url = window.location.origin + getDocumentUrl(contextMenu.backlink);
      window.open(url, '_blank', 'noopener,noreferrer');
      setContextMenu(null);
    }
  }, [contextMenu]);

  const handleCopyLink = useCallback(async () => {
    if (contextMenu) {
      const url = window.location.origin + getDocumentUrl(contextMenu.backlink);
      try {
        await navigator.clipboard.writeText(url);
        showToast('Link copied to clipboard', 'success');
      } catch {
        showToast('Failed to copy link', 'error');
      }
      setContextMenu(null);
    }
  }, [contextMenu, showToast]);

  const getDocumentTypeLabel = (type: string): string => {
    const labels: Record<string, string> = {
      wiki: 'Doc',
      issue: 'Issue',
      program: 'Program',
      project: 'Project',
      sprint: 'Week',
      person: 'Person',
      weekly_plan: 'Week Plan',
      weekly_retro: 'Week Retro',
    };
    return labels[type] || type;
  };

  if (loading) {
    return (
      <div className="space-y-2 p-4">
        <h3 className="text-xs font-medium text-muted">Backlinks</h3>
        <div className="text-xs text-muted">Loading...</div>
      </div>
    );
  }

  const statusMessage = status === 'offline'
    ? (backlinks.length > 0 ? 'Offline. Showing saved backlinks.' : 'Offline. Backlinks will load when connection returns.')
    : status === 'stale'
      ? (backlinks.length > 0 ? 'Connection issue. Showing last updated backlinks.' : 'Connection issue. Retrying backlinks.')
      : null;

  if (statusMessage && backlinks.length === 0) {
    return (
      <div className="space-y-2 p-4">
        <h3 className="text-xs font-medium text-muted">Backlinks</h3>
        <div role="status" aria-live="polite" className="text-xs text-muted">{statusMessage}</div>
      </div>
    );
  }

  return (
    <div className="space-y-2 p-4">
      <h3 className="text-xs font-medium text-muted">Backlinks</h3>
      {statusMessage && (
        <div role="status" aria-live="polite" className="text-xs text-muted">{statusMessage}</div>
      )}

      {backlinks.length === 0 ? (
        <div className="text-xs text-muted">No backlinks</div>
      ) : (
        <div className="space-y-1">
          {backlinks.map((backlink) => (
            <div
              key={backlink.id}
              className="group relative"
            >
              <button
                onClick={() => handleNavigate(backlink)}
                onContextMenu={(e) => handleContextMenu(e, backlink)}
                className="w-full rounded px-2 py-1.5 text-left text-xs hover:bg-border transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset"
              >
                <div className="flex items-center gap-2">
                  <span className="rounded bg-border px-1.5 py-0.5 text-[10px] font-medium text-[#bdbdbd] whitespace-nowrap">
                    {getDocumentTypeLabel(backlink.document_type)}
                  </span>
                  {backlink.display_id && (
                    <span className="font-mono text-[10px] text-muted">
                      {backlink.display_id}
                    </span>
                  )}
                </div>
                <div className="mt-0.5 truncate text-foreground">
                  {backlink.title || 'Untitled'}
                </div>
              </button>
              {/* Three-dot menu button */}
              <button
                type="button"
                onClick={(e) => handleMenuClick(e, backlink)}
                className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded opacity-0 group-hover:opacity-100 focus:opacity-100 hover:bg-border/50 text-muted hover:text-foreground transition-opacity focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                aria-label={`Actions for ${backlink.title || 'Untitled'}`}
                aria-haspopup="menu"
                aria-expanded={contextMenu?.backlink.id === backlink.id}
              >
                <svg className="h-3 w-3" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <circle cx="12" cy="5" r="2" />
                  <circle cx="12" cy="12" r="2" />
                  <circle cx="12" cy="19" r="2" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Context menu */}
      {contextMenu && (
        <ContextMenu x={contextMenu.x} y={contextMenu.y} onClose={() => setContextMenu(null)}>
          <ContextMenuItem onClick={handleOpen}>
            <OpenIcon className="h-4 w-4" />
            Open
          </ContextMenuItem>
          <ContextMenuItem onClick={handleOpenInNewTab}>
            <ExternalLinkIcon className="h-4 w-4" />
            Open in new tab
          </ContextMenuItem>
          <ContextMenuItem onClick={handleCopyLink}>
            <LinkIcon className="h-4 w-4" />
            Copy link
          </ContextMenuItem>
        </ContextMenu>
      )}
    </div>
  );
}

// Icons
function OpenIcon({ className }: { className?: string }) {
  return (
    <svg className={cn('h-4 w-4', className)} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" />
      <rect x="9" y="3" width="6" height="4" rx="1" />
    </svg>
  );
}

function ExternalLinkIcon({ className }: { className?: string }) {
  return (
    <svg className={cn('h-4 w-4', className)} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  );
}

function LinkIcon({ className }: { className?: string }) {
  return (
    <svg className={cn('h-4 w-4', className)} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  );
}
