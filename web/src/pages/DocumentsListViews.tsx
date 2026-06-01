import { WikiDocument } from '@/contexts/DocumentsContext';
import { cn } from '@/lib/cn';

export type ContentSearchDocument = WikiDocument & {
  rank: number;
  snippet: string | null;
  ticket_number: number | null;
};

export function LockIcon({ className }: { className?: string }) {
  return (
    <svg className={className || 'h-4 w-4'} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
        d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
      />
    </svg>
  );
}

export function GlobeIcon({ className }: { className?: string }) {
  return (
    <svg className={className || 'h-4 w-4'} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
        d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9"
      />
    </svg>
  );
}

export function DocumentRowContent({ document, visibleColumns }: { document: WikiDocument; visibleColumns: Set<string> }) {
  return (
    <>
      {/* Title */}
      {visibleColumns.has('title') && (
        <td className="px-4 py-3 text-sm font-medium text-foreground" role="gridcell">
          {document.title || 'Untitled'}
        </td>
      )}
      {/* Visibility */}
      {visibleColumns.has('visibility') && (
        <td className="px-4 py-3" role="gridcell">
          <span className={cn(
            'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs whitespace-nowrap',
            document.visibility === 'private'
              ? 'bg-amber-500/10 text-amber-600'
              : 'bg-blue-500/10 text-blue-600'
          )}>
            {document.visibility === 'private' ? (
              <LockIcon className="h-3 w-3" />
            ) : (
              <GlobeIcon className="h-3 w-3" />
            )}
            {document.visibility === 'private' ? 'Private' : 'Workspace'}
          </span>
        </td>
      )}
      {/* Created By */}
      {visibleColumns.has('created_by') && (
        <td className="px-4 py-3 text-sm text-muted" role="gridcell">
          {document.created_by || '-'}
        </td>
      )}
      {/* Created */}
      {visibleColumns.has('created') && (
        <td className="px-4 py-3 text-sm text-muted" role="gridcell">
          {document.created_at
            ? new Date(document.created_at).toLocaleDateString()
            : '-'}
        </td>
      )}
      {/* Updated */}
      {visibleColumns.has('updated') && (
        <td className="px-4 py-3 text-sm text-muted" role="gridcell">
          {document.updated_at
            ? new Date(document.updated_at).toLocaleDateString()
            : '-'}
        </td>
      )}
    </>
  );
}

export function ContentSearchResults({
  documents,
  loading,
  error,
  onOpenDocument,
}: {
  documents: ContentSearchDocument[];
  loading: boolean;
  error: string | null;
  onOpenDocument: (id: string) => void;
}) {
  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted" role="status" aria-live="polite">
        Searching documents...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="text-center" role="alert">
          <p className="text-sm font-medium text-foreground">Search unavailable</p>
          <p className="mt-1 text-sm text-muted">{error}</p>
        </div>
      </div>
    );
  }

  if (documents.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="text-center">
          <p className="text-muted">No documents found</p>
          <p className="mt-1 text-sm text-muted">Try a different search term or visibility filter</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto p-6 pb-20">
      <ul className="mx-auto max-w-4xl space-y-2" aria-label="Document search results">
        {documents.map((doc) => (
          <li key={doc.id}>
            <button
              type="button"
              onClick={() => onOpenDocument(doc.id)}
              className={cn(
                'block w-full rounded-md border border-border bg-background px-4 py-3 text-left transition-colors',
                'hover:border-accent hover:bg-muted/40',
                'focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2 focus:ring-offset-background'
              )}
            >
              <div className="flex min-w-0 items-center gap-2">
                <span className="truncate text-sm font-medium text-foreground">
                  {doc.title || 'Untitled'}
                </span>
                <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                  {formatDocumentType(doc.document_type)}
                </span>
                {doc.ticket_number ? (
                  <span className="shrink-0 text-xs text-muted">#{doc.ticket_number}</span>
                ) : null}
                <span className="ml-auto shrink-0 text-xs text-muted">
                  {new Date(doc.updated_at).toLocaleDateString()}
                </span>
              </div>
              {doc.snippet ? (
                <p className="mt-1 line-clamp-2 text-sm leading-6 text-muted">
                  <HighlightedSnippet snippet={doc.snippet} />
                </p>
              ) : null}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function HighlightedSnippet({ snippet }: { snippet: string }) {
  const parts = snippet.split(/(<mark>|<\/mark>)/);
  let highlighted = false;

  return (
    <>
      {parts.map((part, index) => {
        if (part === '<mark>') {
          highlighted = true;
          return null;
        }
        if (part === '</mark>') {
          highlighted = false;
          return null;
        }
        return highlighted ? (
          <mark key={index} className="rounded bg-accent/20 px-0.5 text-foreground">
            {part}
          </mark>
        ) : (
          <span key={index}>{part}</span>
        );
      })}
    </>
  );
}

function formatDocumentType(type: string): string {
  return type.charAt(0).toUpperCase() + type.slice(1);
}

export function TrashIcon({ className }: { className?: string }) {
  return (
    <svg className={className || 'h-4 w-4'} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
      />
    </svg>
  );
}

/**
 * DocumentBulkActionBar - Bulk action bar for documents (Delete only for now)
 */
interface DocumentBulkActionBarProps {
  selectedCount: number;
  onDelete: () => void;
  onClearSelection: () => void;
}

export function DocumentBulkActionBar({
  selectedCount,
  onDelete,
  onClearSelection,
}: DocumentBulkActionBarProps) {
  return (
    <div className="flex items-center gap-3 border-b border-border bg-muted/30 px-6 py-2">
      <span className="text-sm text-muted">
        {selectedCount} selected
      </span>
      <div className="h-4 w-px bg-border" />
      <button
        onClick={onDelete}
        className="flex items-center gap-1.5 rounded px-2 py-1 text-sm text-red-600 hover:bg-red-500/10 transition-colors"
      >
        <TrashIcon className="h-4 w-4" />
        Delete
      </button>
      <div className="flex-1" />
      <button
        onClick={onClearSelection}
        className="text-sm text-muted hover:text-foreground transition-colors"
      >
        Clear selection
      </button>
    </div>
  );
}
