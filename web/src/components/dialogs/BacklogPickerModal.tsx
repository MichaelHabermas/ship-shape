import { useState, useEffect, useMemo, useCallback } from 'react';
import { useIssuesQuery, getSprintId, getProjectId, getProgramId } from '@/hooks/useIssuesQuery';
import { IssueListItem } from '@/contexts/IssuesContext';
import { cn } from '@/lib/cn';
import { apiPatch } from '@/lib/api';
import { useToast } from '@/components/ui/Toast';
import { StatusBadge, PriorityBadge } from '@/components/issues/issue-badges';

export interface BacklogPickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** The context to add issues to */
  context: {
    sprintId?: string;
    sprintName?: string;
    projectId?: string;
    projectName?: string;
    programId?: string;
    programName?: string;
  };
  /** Callback when issues are successfully added */
  onIssuesAdded?: () => void;
}

/**
 * BacklogPickerModal - Modal for selecting multiple issues from backlog to add to a sprint/project/program
 *
 * Features:
 * - Fetches all issues not in the current context
 * - Checkbox multi-select
 * - Already-added issues are greyed out
 * - "Add to {context}" button patches all selected issues
 */
export function BacklogPickerModal({ isOpen, onClose, context, onIssuesAdded }: BacklogPickerModalProps) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isAdding, setIsAdding] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const { showToast } = useToast();

  // Fetch all issues (no filter)
  const { data: allIssues = [], isLoading } = useIssuesQuery({}, { enabled: isOpen });

  // Determine context name for display
  const contextName = useMemo(() => {
    if (context.sprintName) return context.sprintName;
    if (context.projectName) return context.projectName;
    if (context.programName) return context.programName;
    return 'context';
  }, [context]);

  const contextType = useMemo(() => {
    if (context.sprintId) return 'sprint';
    if (context.projectId) return 'project';
    if (context.programId) return 'program';
    return 'context';
  }, [context]);

  // Filter issues: exclude ones already in context, and apply search
  const { availableIssues, alreadyInContext } = useMemo(() => {
    const available: IssueListItem[] = [];
    const inContext: Set<string> = new Set();

    allIssues.forEach(issue => {
      const issueSprintId = getSprintId(issue);
      const issueProjectId = getProjectId(issue);
      const issueProgramId = getProgramId(issue);

      // Check if issue is already in the target context
      let isInContext = false;
      if (context.sprintId && issueSprintId === context.sprintId) {
        isInContext = true;
      }
      // For project context, also check if already associated
      if (context.projectId && !context.sprintId && issueProjectId === context.projectId) {
        isInContext = true;
      }
      // For program context, also check if already associated
      if (context.programId && !context.sprintId && !context.projectId && issueProgramId === context.programId) {
        isInContext = true;
      }

      if (isInContext) {
        inContext.add(issue.id);
      }
      available.push(issue);
    });

    // Apply search filter
    const searchLower = searchQuery.toLowerCase();
    const filtered = searchQuery
      ? available.filter(issue =>
          issue.title.toLowerCase().includes(searchLower) ||
          issue.ticket_number?.toString().includes(searchLower)
        )
      : available;

    // Sort: not-in-context first, then by updated_at
    filtered.sort((a, b) => {
      const aInContext = inContext.has(a.id);
      const bInContext = inContext.has(b.id);
      if (aInContext !== bInContext) return aInContext ? 1 : -1;
      return new Date(b.updated_at || 0).getTime() - new Date(a.updated_at || 0).getTime();
    });

    return { availableIssues: filtered, alreadyInContext: inContext };
  }, [allIssues, context, searchQuery]);

  // Handle Escape key
  useEffect(() => {
    if (!isOpen || isAdding) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isAdding, onClose]);

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setSelectedIds(new Set());
      setSearchQuery('');
    }
  }, [isOpen]);

  const toggleSelection = useCallback((id: string) => {
    setSelectedIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return newSet;
    });
  }, []);

  const handleSelectAll = useCallback(() => {
    const selectableIds = availableIssues
      .filter(issue => !alreadyInContext.has(issue.id))
      .map(issue => issue.id);
    setSelectedIds(new Set(selectableIds));
  }, [availableIssues, alreadyInContext]);

  const handleClearSelection = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const handleAddToContext = useCallback(async () => {
    if (selectedIds.size === 0) return;

    setIsAdding(true);
    try {
      const selectedIssues = availableIssues.filter(issue => selectedIds.has(issue.id));
      const errors: string[] = [];

      // Add each issue to the context
      for (const issue of selectedIssues) {
        // Build the updated belongs_to array
        const existingBelongsTo = issue.belongs_to || [];

        // Add new context associations
        const newBelongsTo = [...existingBelongsTo];

        if (context.sprintId && !existingBelongsTo.some(b => b.id === context.sprintId)) {
          newBelongsTo.push({ id: context.sprintId, type: 'sprint' });
        }
        if (context.projectId && !existingBelongsTo.some(b => b.id === context.projectId)) {
          newBelongsTo.push({ id: context.projectId, type: 'project' });
        }
        if (context.programId && !existingBelongsTo.some(b => b.id === context.programId)) {
          newBelongsTo.push({ id: context.programId, type: 'program' });
        }

        try {
          const res = await apiPatch(`/api/documents/${issue.id}`, {
            belongs_to: newBelongsTo,
          });

          if (!res.ok) {
            errors.push(issue.title);
          }
        } catch {
          errors.push(issue.title);
        }
      }

      if (errors.length === 0) {
        showToast(`${selectedIds.size} issue${selectedIds.size === 1 ? '' : 's'} added to ${contextName}`, 'success');
        onIssuesAdded?.();
        onClose();
      } else if (errors.length < selectedIds.size) {
        showToast(`Some issues added, but ${errors.length} failed`, 'error');
        onIssuesAdded?.();
        onClose();
      } else {
        showToast('Failed to add issues', 'error');
      }
    } finally {
      setIsAdding(false);
    }
  }, [selectedIds, availableIssues, context, contextName, onClose, onIssuesAdded, showToast]);

  // Handle click outside dialog
  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget && !isAdding) {
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      role="dialog"
      aria-modal="true"
      onClick={handleBackdropClick}
    >
      <div className="w-full max-w-3xl h-[80vh] flex flex-col rounded-lg bg-background shadow-lg">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Add to {contextName}</h2>
            <p className="text-sm text-muted">Select issues from the backlog to add to this {contextType}</p>
          </div>
          <button
            onClick={onClose}
            disabled={isAdding}
            className="text-muted hover:text-foreground transition-colors disabled:opacity-50"
            aria-label="Close"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Search and actions */}
        <div className="flex items-center gap-4 border-b border-border px-6 py-3">
          <div className="flex-1">
            <input
              type="text"
              placeholder="Search issues..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </div>
          <div className="flex items-center gap-2 text-sm">
            <button
              onClick={handleSelectAll}
              className="text-muted hover:text-foreground transition-colors"
            >
              Select all
            </button>
            <span className="text-border">|</span>
            <button
              onClick={handleClearSelection}
              className="text-muted hover:text-foreground transition-colors"
            >
              Clear
            </button>
          </div>
        </div>

        {/* Issues list */}
        <div className="flex-1 overflow-auto">
          {isLoading ? (
            <div className="flex items-center justify-center h-full">
              <span className="text-muted">Loading issues...</span>
            </div>
          ) : availableIssues.length === 0 ? (
            <div className="flex items-center justify-center h-full">
              <span className="text-muted">
                {searchQuery ? 'No issues match your search' : 'No issues available'}
              </span>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {availableIssues.map(issue => {
                const isInContext = alreadyInContext.has(issue.id);
                const isSelected = selectedIds.has(issue.id);

                return (
                  <div
                    key={issue.id}
                    className={cn(
                      'flex items-center gap-4 px-6 py-3',
                      isInContext && 'opacity-50 bg-border/20',
                      !isInContext && 'hover:bg-border/50 cursor-pointer',
                      isSelected && !isInContext && 'bg-accent/10'
                    )}
                    onClick={() => !isInContext && toggleSelection(issue.id)}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      disabled={isInContext}
                      onChange={() => toggleSelection(issue.id)}
                      onClick={(e) => e.stopPropagation()}
                      className="h-4 w-4 rounded border-border text-accent focus:ring-accent disabled:opacity-50"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted">#{issue.ticket_number}</span>
                        <span className="text-sm text-foreground truncate">{issue.title}</span>
                      </div>
                      {isInContext && (
                        <span className="text-xs text-muted">Already in {contextName}</span>
                      )}
                    </div>
                    <StatusBadge state={issue.state} />
                    <PriorityBadge priority={issue.priority} />
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-border px-6 py-4">
          <span className="text-sm text-muted">
            {selectedIds.size} issue{selectedIds.size === 1 ? '' : 's'} selected
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              disabled={isAdding}
              className="rounded px-3 py-1.5 text-sm text-muted hover:text-foreground transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={handleAddToContext}
              disabled={isAdding || selectedIds.size === 0}
              className="rounded bg-accent px-4 py-1.5 text-sm font-medium text-white hover:bg-accent/90 disabled:opacity-50 transition-colors flex items-center gap-2"
            >
              {isAdding ? (
                <>
                  <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  Adding...
                </>
              ) : (
                `Add to ${contextName}`
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
