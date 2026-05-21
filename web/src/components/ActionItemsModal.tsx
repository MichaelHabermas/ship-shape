import { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { useNavigate } from 'react-router-dom';
import { cn } from '@/lib/cn';
import { useActionItemsQuery, ActionItem } from '@/hooks/useActionItemsQuery';
import {
  ACCOUNTABILITY_TYPE_LABELS,
  createOrGetWeeklyDocumentId,
  formatActionItemDueDate,
  getWeeklyDocumentKindForAccountabilityType,
} from '@/lib/accountability';

const ACCOUNTABILITY_TYPE_ICONS: Record<string, React.ReactNode> = {
  standup: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
    </svg>
  ),
  weekly_plan: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
    </svg>
  ),
  weekly_retro: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
    </svg>
  ),
  weekly_review: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  ),
  week_start: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  ),
  week_issues: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
    </svg>
  ),
  project_plan: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
    </svg>
  ),
  project_retro: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
    </svg>
  ),
  changes_requested_plan: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
    </svg>
  ),
  changes_requested_retro: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
    </svg>
  ),
};

function ActionItemRow({ item, onItemClick, isLoading }: { item: ActionItem; onItemClick: (item: ActionItem) => void; isLoading?: boolean }) {
  const typeLabel = item.accountability_type
    ? ACCOUNTABILITY_TYPE_LABELS[item.accountability_type] || item.accountability_type
    : 'Action Item';
  const icon = item.accountability_type
    ? ACCOUNTABILITY_TYPE_ICONS[item.accountability_type]
    : null;
  const { text: dueText, isOverdue } = formatActionItemDueDate(item.due_date, item.days_overdue);

  return (
    <button
      onClick={() => onItemClick(item)}
      disabled={isLoading}
      className="w-full flex items-center gap-4 px-4 py-3 hover:bg-border/50 transition-colors text-left disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset"
    >
      {/* Type icon */}
      <span className={cn(
        'flex items-center justify-center h-10 w-10 rounded-full flex-shrink-0',
        isOverdue ? 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400' : 'bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400'
      )}>
        {icon}
      </span>

      {/* Item info */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="text-xs font-semibold text-muted uppercase tracking-wide">{typeLabel}</span>
        </div>
        <p className="text-sm font-medium text-foreground">{item.title}</p>
        {item.target_title && (
          <p className="text-xs text-muted mt-0.5 truncate">{item.target_title}</p>
        )}
      </div>

      {/* Due date badge */}
      <span className={cn(
        'px-2 py-1 text-xs font-medium rounded whitespace-nowrap',
        isOverdue
          ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'
          : 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300'
      )}>
        {dueText}
      </span>

      {/* Arrow indicator */}
      <svg className="w-4 h-4 text-muted flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
      </svg>
    </button>
  );
}

interface ActionItemsModalProps {
  open: boolean;
  onClose: () => void;
}

export function ActionItemsModal({ open, onClose }: ActionItemsModalProps) {
  const navigate = useNavigate();
  const { data, isLoading } = useActionItemsQuery();
  const [navigatingItemId, setNavigatingItemId] = useState<string | null>(null);

  const handleItemClick = async (item: ActionItem) => {
    const weeklyDocKind = getWeeklyDocumentKindForAccountabilityType(item.accountability_type);
    if (weeklyDocKind && item.person_id && item.week_number != null) {
      setNavigatingItemId(item.id);
      try {
        const documentId = await createOrGetWeeklyDocumentId({
          kind: weeklyDocKind,
          personId: item.person_id,
          projectId: item.project_id || undefined,
          weekNumber: item.week_number,
        });
        const fallbackUrl = item.accountability_target_id
          ? `/documents/${item.accountability_target_id}`
          : `/documents/${item.id}`;
        onClose();
        navigate(documentId ? `/documents/${documentId}` : fallbackUrl);
      } finally {
        setNavigatingItemId(null);
      }
      return;
    }

    if (item.accountability_type === 'standup' && item.accountability_target_id) {
      onClose();
      navigate(`/documents/${item.accountability_target_id}?action=new-standup`);
      return;
    }

    onClose();
    navigate(item.accountability_target_id ? `/documents/${item.accountability_target_id}` : `/documents/${item.id}`);
  };

  const items = data?.items ?? [];
  const overdueCount = items.filter(item => item.days_overdue >= 0).length;
  const totalCount = items.length;

  return (
    <Dialog.Root open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[100] bg-black/60" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-[101] w-full max-w-lg max-h-[80vh] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-background shadow-xl focus:outline-none flex flex-col"
          onEscapeKeyDown={onClose}
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-border px-6 py-4">
            <div>
              <Dialog.Title className="text-lg font-semibold text-foreground flex items-center gap-2">
                <svg className="w-5 h-5 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                Action Items
              </Dialog.Title>
              <Dialog.Description className="text-sm text-muted mt-1">
                {totalCount > 0 ? (
                  <>
                    You have <span className="font-medium text-foreground">{totalCount}</span> pending item{totalCount !== 1 ? 's' : ''}
                    {overdueCount > 0 && (
                      <span className="text-red-500"> ({overdueCount} overdue)</span>
                    )}
                  </>
                ) : (
                  'All caught up!'
                )}
              </Dialog.Description>
            </div>
            <button
              onClick={onClose}
              className="rounded-md p-1 text-muted hover:bg-border hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              aria-label="Close"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-auto">
            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <div className="flex items-center gap-2 text-muted">
                  <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24" aria-hidden="true">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  <span className="text-sm">Loading action items...</span>
                </div>
              </div>
            ) : items.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <svg className="w-12 h-12 text-green-500 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <p className="text-lg font-medium text-foreground">All done!</p>
                <p className="text-sm text-muted mt-1">You have no pending accountability tasks.</p>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {items.map((item) => (
                  <ActionItemRow
                    key={item.id}
                    item={item}
                    onItemClick={handleItemClick}
                    isLoading={navigatingItemId === item.id}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="border-t border-border px-6 py-4 flex items-center justify-between">
            <p className="text-xs text-muted">
              Click the banner to reopen this list
            </p>
            <button
              onClick={onClose}
              className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent/90 focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2 focus:ring-offset-background"
            >
              Got it
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export default ActionItemsModal;
