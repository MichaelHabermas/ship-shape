import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useDocuments, WikiDocument } from '@/contexts/DocumentsContext';
import { useCurrentDocument } from '@/contexts/CurrentDocumentContext';
import { buildDocumentTree } from '@/lib/documentTree';
import { DocumentTreeItem } from '@/components/DocumentTreeItem';
import { DocumentsListSkeleton } from '@/components/ui/Skeleton';
import { useToast } from '@/components/ui/Toast';
import { cn } from '@/lib/cn';
import { apiGet } from '@/lib/api';
import { SelectableList, RowRenderProps, UseSelectionReturn } from '@/components/SelectableList';
import { useColumnVisibility, ColumnDefinition } from '@/hooks/useColumnVisibility';
import { useListFilters } from '@/hooks/useListFilters';
import { DocumentListToolbar } from '@/components/DocumentListToolbar';
import { FilterTabs } from '@/components/FilterTabs';
import { ContextMenu, ContextMenuItem } from '@/components/ui/ContextMenu';

// Column definitions for list view
const ALL_COLUMNS: ColumnDefinition[] = [
  { key: 'title', label: 'Title', hideable: false },
  { key: 'visibility', label: 'Visibility', hideable: true },
  { key: 'created_by', label: 'Created By', hideable: true },
  { key: 'created', label: 'Created', hideable: true },
  { key: 'updated', label: 'Updated', hideable: true },
];

// Sort options for list view
const SORT_OPTIONS = [
  { value: 'title', label: 'Title' },
  { value: 'created', label: 'Created' },
  { value: 'updated', label: 'Updated' },
];

// localStorage key for column visibility
const COLUMN_VISIBILITY_KEY = 'documents-column-visibility';

type VisibilityFilter = 'all' | 'workspace' | 'private';

type ContentSearchDocument = WikiDocument & {
  rank: number;
  snippet: string | null;
  ticket_number: number | null;
};

type ContentSearchResponse = {
  documents: Array<{
    id: string;
    title: string | null;
    document_type: string;
    visibility: 'private' | 'workspace';
    ticket_number: number | null;
    updated_at: string;
    rank: number;
    snippet: string | null;
  }>;
  total: number;
};

export function DocumentsPage() {
  const { documents, loading, createDocument, deleteDocument } = useDocuments();
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState('');
  const [contentSearchResults, setContentSearchResults] = useState<ContentSearchDocument[]>([]);
  const [contentSearchLoading, setContentSearchLoading] = useState(false);
  const [contentSearchError, setContentSearchError] = useState<string | null>(null);
  const searchRequestId = useRef(0);
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const { currentDocumentId, currentDocumentType } = useCurrentDocument();
  const activeDocumentId = currentDocumentType === 'wiki' ? currentDocumentId ?? undefined : undefined;

  // Use shared hooks for list state management (matches Issues page)
  const { sortBy, setSortBy, viewMode, setViewMode } = useListFilters({
    sortOptions: SORT_OPTIONS,
    defaultSort: 'title',
    storageKey: 'documents',
    defaultViewMode: 'tree',
  });

  // Selection state for list view
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Context menu state for list view
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; selection: UseSelectionReturn } | null>(null);

  // Column visibility for list view
  const {
    visibleColumns,
    columns,
    hiddenCount,
    toggleColumn,
  } = useColumnVisibility({
    columns: ALL_COLUMNS,
    storageKey: COLUMN_VISIBILITY_KEY,
  });

  // Get filter from URL params
  const filterParam = searchParams.get('filter');
  const visibilityFilter: VisibilityFilter =
    filterParam === 'workspace' || filterParam === 'private' ? filterParam : 'all';
  const normalizedSearch = search.trim();
  const isContentSearchActive = normalizedSearch.length > 0;

  useEffect(() => {
    if (!normalizedSearch) {
      searchRequestId.current += 1;
      setContentSearchResults([]);
      setContentSearchLoading(false);
      setContentSearchError(null);
      return;
    }

    const requestId = searchRequestId.current + 1;
    searchRequestId.current = requestId;
    setContentSearchLoading(true);
    setContentSearchError(null);

    const timeoutId = window.setTimeout(async () => {
      try {
        const params = new URLSearchParams({
          q: normalizedSearch,
          limit: '50',
        });
        const res = await apiGet(`/api/search/content?${params.toString()}`);
        if (!res.ok) {
          throw new Error('Search failed');
        }

        const data = await res.json() as ContentSearchResponse;
        if (searchRequestId.current !== requestId) return;

        setContentSearchResults(data.documents.map((doc) => ({
          id: doc.id,
          title: doc.title ?? 'Untitled',
          document_type: doc.document_type,
          parent_id: null,
          position: 0,
          created_at: doc.updated_at,
          updated_at: doc.updated_at,
          visibility: doc.visibility,
          rank: doc.rank,
          snippet: doc.snippet,
          ticket_number: doc.ticket_number,
        })));
      } catch (error) {
        if (searchRequestId.current !== requestId) return;
        setContentSearchError(error instanceof Error ? error.message : 'Search failed');
        setContentSearchResults([]);
      } finally {
        if (searchRequestId.current === requestId) {
          setContentSearchLoading(false);
        }
      }
    }, 250);

    return () => window.clearTimeout(timeoutId);
  }, [normalizedSearch]);

  // Filter documents by visibility and search
  const filteredDocuments = useMemo(() => {
    let filtered: WikiDocument[] = isContentSearchActive ? contentSearchResults : documents;

    // Filter by visibility
    if (visibilityFilter === 'workspace') {
      filtered = filtered.filter(d => d.visibility !== 'private');
    } else if (visibilityFilter === 'private') {
      filtered = filtered.filter(d => d.visibility === 'private');
    }

    return filtered;
  }, [contentSearchResults, documents, isContentSearchActive, visibilityFilter]);

  // Build tree structure from filtered documents (for tree view)
  const documentTree = useMemo(() => buildDocumentTree(filteredDocuments), [filteredDocuments]);

  // Sort documents for list view
  const sortedDocuments = useMemo(() => {
    if (viewMode !== 'list') return filteredDocuments;

    const sorted = [...filteredDocuments];
    switch (sortBy) {
      case 'title':
        sorted.sort((a, b) => a.title.localeCompare(b.title));
        break;
      case 'created':
        sorted.sort((a, b) => {
          const aDate = a.created_at ? new Date(a.created_at).getTime() : 0;
          const bDate = b.created_at ? new Date(b.created_at).getTime() : 0;
          return bDate - aDate; // Newest first
        });
        break;
      case 'updated':
        sorted.sort((a, b) => {
          const aDate = a.updated_at ? new Date(a.updated_at).getTime() : 0;
          const bDate = b.updated_at ? new Date(b.updated_at).getTime() : 0;
          return bDate - aDate; // Newest first
        });
        break;
    }
    return sorted;
  }, [filteredDocuments, sortBy, viewMode]);

  // Render function for document rows in list view
  const renderDocumentRow = useCallback((doc: WikiDocument, { isSelected: _isSelected }: RowRenderProps) => (
    <DocumentRowContent document={doc} visibleColumns={visibleColumns} />
  ), [visibleColumns]);

  async function handleCreateDocument(parentId?: string) {
    setCreating(true);
    try {
      const doc = await createDocument(parentId);
      if (doc) {
        navigate(`/documents/${doc.id}`);
      }
    } finally {
      setCreating(false);
    }
  }

  function handleFilterChange(filter: VisibilityFilter) {
    const nextParams = new URLSearchParams(searchParams);
    if (filter === 'all') {
      nextParams.delete('filter');
    } else {
      nextParams.set('filter', filter);
    }
    setSearchParams(nextParams);
  }

  // Delete with notification
  const handleDeleteWithUndo = useCallback(async (id: string) => {
    // Find the document before deleting
    const docToDelete = documents.find(d => d.id === id);
    if (!docToDelete) return;

    // Perform the delete
    const success = await deleteDocument(id);
    if (!success) return;

    // Show toast notification
    showToast(`"${docToDelete.title || 'Untitled'}" deleted`, 'info');
  }, [documents, deleteDocument, showToast]);

  // Bulk delete handler
  const handleBulkDelete = useCallback(async () => {
    const idsToDelete = Array.from(selectedIds);
    if (idsToDelete.length === 0) return;

    const count = idsToDelete.length;

    // Delete all selected documents
    await Promise.all(idsToDelete.map(id => deleteDocument(id)));

    // Clear selection and context menu
    setSelectedIds(new Set());
    setContextMenu(null);

    // Show toast notification
    showToast(`${count} document${count === 1 ? '' : 's'} deleted`, 'info');
  }, [selectedIds, deleteDocument, showToast]);

  // Context menu handler
  const handleContextMenu = useCallback((e: React.MouseEvent, _item: WikiDocument, selection: UseSelectionReturn) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, selection });
  }, []);

  if (loading) {
    return <DocumentsListSkeleton />;
  }

  // Search filter content for toolbar (matches Issues pattern)
  const searchFilterContent = (
    <div className="w-48">
      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        aria-label="Search documents"
        placeholder="Search..."
        className={cn(
          'w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm',
          'placeholder:text-muted',
          'focus:outline-none focus:ring-1 focus:ring-accent'
        )}
      />
    </div>
  );

  return (
    <div className="flex h-full flex-col">
      {/* Header - matches Issues layout */}
      <div className="flex items-center justify-between border-b border-border px-6 py-4">
        <h1 className="text-xl font-semibold text-foreground">Documents</h1>
        <DocumentListToolbar
          sortOptions={SORT_OPTIONS}
          sortBy={sortBy}
          onSortChange={setSortBy}
          viewModes={['tree', 'list']}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          allColumns={ALL_COLUMNS}
          visibleColumns={visibleColumns}
          onToggleColumn={toggleColumn}
          hiddenCount={hiddenCount}
          showColumnPicker={viewMode === 'list'}
          filterContent={searchFilterContent}
          createButton={{ label: creating ? 'Creating...' : 'New Document', onClick: () => handleCreateDocument(), disabled: creating }}
        />
      </div>

      {/* Filter tabs OR Bulk action bar (mutually exclusive) - matches Issues */}
      {selectedIds.size > 0 ? (
        <DocumentBulkActionBar
          selectedCount={selectedIds.size}
          onDelete={handleBulkDelete}
          onClearSelection={() => setSelectedIds(new Set())}
        />
      ) : (
        <FilterTabs
          tabs={[
            { id: 'all', label: 'All' },
            { id: 'workspace', label: 'Workspace', icon: <GlobeIcon className="h-3.5 w-3.5" /> },
            { id: 'private', label: 'Private', icon: <LockIcon className="h-3.5 w-3.5" /> },
          ]}
          activeId={visibilityFilter}
          onChange={(id) => handleFilterChange(id as VisibilityFilter)}
          ariaLabel="Document visibility filters"
        />
      )}

      {/* Content */}
      {isContentSearchActive ? (
        <ContentSearchResults
          documents={filteredDocuments as ContentSearchDocument[]}
          loading={contentSearchLoading}
          error={contentSearchError}
          onOpenDocument={(id) => navigate(`/documents/${id}`)}
        />
      ) : filteredDocuments.length === 0 ? (
        <div className="flex flex-1 items-center justify-center">
          <div className="text-center">
            {documents.length === 0 ? (
              <>
                <p className="text-muted">No documents yet</p>
                <button
                  onClick={() => handleCreateDocument()}
                  className="mt-2 text-sm text-accent hover:underline"
                >
                  Create your first document
                </button>
              </>
            ) : (
              <>
                <p className="text-muted">No documents found</p>
                <p className="mt-1 text-sm text-muted">
                  Try adjusting your search or filter
                </p>
              </>
            )}
          </div>
        </div>
      ) : viewMode === 'tree' ? (
        <div className="flex-1 overflow-auto p-6 pb-20">
          <ul role="tree" aria-label="Documents" className="space-y-0.5">
            {documentTree.map((doc) => (
              <DocumentTreeItem
                key={doc.id}
                document={doc}
                activeDocumentId={activeDocumentId}
                autoExpandActive
                onCreateChild={handleCreateDocument}
                onDelete={handleDeleteWithUndo}
              />
            ))}
          </ul>
        </div>
      ) : (
        <div className="flex-1 overflow-auto pb-20">
          <SelectableList
            items={sortedDocuments}
            getItemId={(doc) => doc.id}
            renderRow={(doc, props) => renderDocumentRow(doc, props)}
            columns={columns}
            onItemClick={(doc) => navigate(`/documents/${doc.id}`)}
            selectable={true}
            onSelectionChange={(ids) => setSelectedIds(ids)}
            onContextMenu={handleContextMenu}
            ariaLabel="Documents list"
          />

          {/* Context menu */}
          {contextMenu && (
            <ContextMenu x={contextMenu.x} y={contextMenu.y} onClose={() => setContextMenu(null)}>
              <ContextMenuItem onClick={handleBulkDelete} destructive>
                <TrashIcon className="h-4 w-4" />
                Delete {selectedIds.size > 1 ? `${selectedIds.size} documents` : 'document'}
              </ContextMenuItem>
            </ContextMenu>
          )}
        </div>
      )}
    </div>
  );
}

function LockIcon({ className }: { className?: string }) {
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

function GlobeIcon({ className }: { className?: string }) {
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

function DocumentRowContent({ document, visibleColumns }: { document: WikiDocument; visibleColumns: Set<string> }) {
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

function ContentSearchResults({
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

function TrashIcon({ className }: { className?: string }) {
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

function DocumentBulkActionBar({
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
