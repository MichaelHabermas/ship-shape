import { Project } from '@/contexts/ProjectsContext';
import { ArchiveIcon } from '@/components/icons/ArchiveIcon';
import { cn } from '@/lib/cn';
import { formatDate } from '@/lib/date-utils';

/**
 * ProjectRowContent - Renders the content cells for a project row
 * Used by SelectableList which handles the <tr>, checkbox, and selection state
 */
interface ProjectRowContentProps {
  project: Project;
  isSelected: boolean;
  visibleColumns: Set<string>;
  programNameById: Map<string, string>;
}

export function ProjectRowContent({ project, visibleColumns, programNameById }: ProjectRowContentProps) {
  return (
    <>
      {/* Title with color dot */}
      {visibleColumns.has('title') && (
        <td className="px-4 py-3 text-sm text-foreground" role="gridcell">
          <div className="flex items-center gap-2">
            <div
              className="h-2.5 w-2.5 rounded-full flex-shrink-0"
              style={{ backgroundColor: project.color || '#6366f1' }}
              aria-hidden="true"
            />
            <span className={project.archived_at ? 'text-muted line-through' : ''}>
              {project.title}
            </span>
            {project.is_complete === false && (
              <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium bg-orange-500/10 text-orange-500 border border-orange-500/20 whitespace-nowrap">
                Incomplete
              </span>
            )}
          </div>
        </td>
      )}
      {/* Impact */}
      {visibleColumns.has('impact') && (
        <td className="px-4 py-3 text-sm text-center" role="gridcell">
          <ICEBadge value={project.impact} />
        </td>
      )}
      {/* Confidence */}
      {visibleColumns.has('confidence') && (
        <td className="px-4 py-3 text-sm text-center" role="gridcell">
          <ICEBadge value={project.confidence} />
        </td>
      )}
      {/* Ease */}
      {visibleColumns.has('ease') && (
        <td className="px-4 py-3 text-sm text-center" role="gridcell">
          <ICEBadge value={project.ease} />
        </td>
      )}
      {/* ICE Score */}
      {visibleColumns.has('score') && (
        <td className="px-4 py-3 text-sm text-center font-medium" role="gridcell">
          <span className="inline-flex items-center justify-center rounded bg-accent px-2 py-0.5 text-white whitespace-nowrap">
            {project.ice_score}
          </span>
        </td>
      )}
      {/* Program */}
      {visibleColumns.has('program') && (
        <td className="px-4 py-3 text-sm text-muted" role="gridcell">
          {project.program_id ? programNameById.get(project.program_id) || '—' : '—'}
        </td>
      )}
      {/* Design Review */}
      {visibleColumns.has('designReview') && (
        <td className="px-4 py-3 text-sm" role="gridcell">
          {project.has_design_review ? (
            <span className="inline-flex items-center gap-1.5 text-green-500">
              <CheckIcon className="h-4 w-4" />
              <span className="font-medium">Approved</span>
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-muted">
              <XCircleIcon className="h-4 w-4" />
              <span>Not Approved</span>
            </span>
          )}
        </td>
      )}
      {/* Owner */}
      {visibleColumns.has('owner') && (
        <td className="px-4 py-3 text-sm text-muted" role="gridcell">
          {project.owner?.name || 'Unassigned'}
        </td>
      )}
      {/* Updated */}
      {visibleColumns.has('updated') && (
        <td className="px-4 py-3 text-sm text-muted" role="gridcell">
          {project.updated_at ? formatDate(project.updated_at) : '-'}
        </td>
      )}
    </>
  );
}

function ICEBadge({ value }: { value: number | null }) {
  if (value === null) {
    return <span className="font-medium text-muted">&mdash;</span>;
  }
  const colors = {
    1: 'text-red-500',
    2: 'text-orange-500',
    3: 'text-yellow-500',
    4: 'text-lime-500',
    5: 'text-green-500',
  };
  return (
    <span className={cn('font-medium', colors[value as keyof typeof colors] || 'text-muted')}>
      {value}
    </span>
  );
}

interface ProjectsBulkActionBarProps {
  selectedCount: number;
  onClearSelection: () => void;
  onArchive: () => void;
  onDelete: () => void;
}

export function ProjectsBulkActionBar({
  selectedCount,
  onClearSelection,
  onArchive,
  onDelete,
}: ProjectsBulkActionBarProps) {
  if (selectedCount === 0) {
    return null;
  }

  return (
    <div
      role="region"
      aria-label="Bulk actions"
      aria-live="polite"
      className={cn(
        'flex items-center gap-3 border-b border-accent/30 bg-accent/10 px-6 py-2',
        'animate-in slide-in-from-top-2 fade-in duration-150'
      )}
    >
      {/* Selection count */}
      <span className="text-sm font-medium text-foreground">
        {selectedCount} selected
      </span>

      <div className="h-4 w-px bg-border" aria-hidden="true" />

      {/* Archive button */}
      <button
        onClick={onArchive}
        className="flex items-center gap-1.5 rounded px-2.5 py-1.5 text-sm font-medium text-muted hover:bg-border/50 hover:text-foreground transition-colors"
      >
        <ArchiveIcon className="h-4 w-4" />
        Archive
      </button>

      {/* Delete button */}
      <button
        onClick={onDelete}
        className="flex items-center gap-1.5 rounded px-2.5 py-1.5 text-sm font-medium text-red-400 hover:bg-red-500/10 hover:text-red-300 transition-colors"
      >
        <TrashIcon className="h-4 w-4" />
        Delete
      </button>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Clear selection */}
      <button
        onClick={onClearSelection}
        className="flex items-center gap-1.5 rounded px-2 py-1 text-sm text-muted hover:bg-border/50 hover:text-foreground transition-colors"
        aria-label="Clear selection"
      >
        <XIcon className="h-4 w-4" />
        Clear
      </button>
    </div>
  );
}

export function TrashIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
    </svg>
  );
}

function XIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}

export function ArrowDownLeftIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 7L7 17M7 17H17M7 17V7" />
    </svg>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
    </svg>
  );
}

function XCircleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="10" strokeWidth={1.5} />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 9l-6 6M9 9l6 6" />
    </svg>
  );
}
