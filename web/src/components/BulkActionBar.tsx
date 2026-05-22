import { useState, useCallback, useRef, useEffect } from 'react';
import { cn } from '@/lib/cn';
import { ArchiveIcon } from '@/components/icons/ArchiveIcon';
import { ISSUE_STATE_OPTIONS } from '@ship/shared';

interface Sprint {
  id: string;
  name: string;
}

interface TeamMember {
  id: string;
  name: string;
}

interface Project {
  id: string;
  title: string;
}

export interface BulkActionBarProps {
  /** Number of selected items */
  selectedCount: number;
  /** Callback to clear selection */
  onClearSelection: () => void;
  /** Callback to archive selected items */
  onArchive: () => void;
  /** Callback to delete selected items */
  onDelete: () => void;
  /** Callback to change status of selected items */
  onChangeStatus: (status: string) => void;
  /** Callback to move selected items to a sprint */
  onMoveToSprint: (sprintId: string | null) => void;
  /** Callback to assign selected items to a team member */
  onAssign?: (assigneeId: string | null) => void;
  /** Callback to assign selected items to a project */
  onAssignProject?: (projectId: string | null) => void;
  /** Available sprints for the dropdown */
  sprints?: Sprint[];
  /** Available team members for the dropdown */
  teamMembers?: TeamMember[];
  /** Available projects for the dropdown */
  projects?: Project[];
  /** Whether actions are loading */
  loading?: boolean;
}

/**
 * BulkActionBar - Appears when items are selected to provide bulk operations
 *
 * Features:
 * - Shows selection count
 * - Archive, Move to Sprint, Delete, Change Status buttons
 * - Dropdown pickers for Sprint and Status
 * - Accessible with keyboard support
 */
export function BulkActionBar({
  selectedCount,
  onClearSelection,
  onArchive,
  onDelete,
  onChangeStatus,
  onMoveToSprint,
  onAssign,
  onAssignProject,
  sprints = [],
  teamMembers = [],
  projects = [],
  loading = false,
}: BulkActionBarProps) {
  const [statusOpen, setStatusOpen] = useState(false);
  const [sprintOpen, setSprintOpen] = useState(false);
  const [assigneeOpen, setAssigneeOpen] = useState(false);
  const [projectOpen, setProjectOpen] = useState(false);
  const statusRef = useRef<HTMLDivElement>(null);
  const sprintRef = useRef<HTMLDivElement>(null);
  const assigneeRef = useRef<HTMLDivElement>(null);
  const projectRef = useRef<HTMLDivElement>(null);

  // Close dropdowns when clicking outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (statusRef.current && !statusRef.current.contains(e.target as Node)) {
        setStatusOpen(false);
      }
      if (sprintRef.current && !sprintRef.current.contains(e.target as Node)) {
        setSprintOpen(false);
      }
      if (assigneeRef.current && !assigneeRef.current.contains(e.target as Node)) {
        setAssigneeOpen(false);
      }
      if (projectRef.current && !projectRef.current.contains(e.target as Node)) {
        setProjectOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Close dropdowns on Escape
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setStatusOpen(false);
        setSprintOpen(false);
        setAssigneeOpen(false);
        setProjectOpen(false);
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleStatusSelect = useCallback((status: string) => {
    onChangeStatus(status);
    setStatusOpen(false);
  }, [onChangeStatus]);

  const handleSprintSelect = useCallback((sprintId: string | null) => {
    onMoveToSprint(sprintId);
    setSprintOpen(false);
  }, [onMoveToSprint]);

  const handleAssigneeSelect = useCallback((assigneeId: string | null) => {
    onAssign?.(assigneeId);
    setAssigneeOpen(false);
  }, [onAssign]);

  const handleProjectSelect = useCallback((projectId: string | null) => {
    onAssignProject?.(projectId);
    setProjectOpen(false);
  }, [onAssignProject]);

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
      <ActionButton
        onClick={onArchive}
        disabled={loading}
        icon={<ArchiveIcon />}
        label="Archive"
      />

      {/* Change Status dropdown */}
      <div className="relative" ref={statusRef}>
        <ActionButton
          onClick={() => { setSprintOpen(false); setAssigneeOpen(false); setProjectOpen(false); setStatusOpen(!statusOpen); }}
          disabled={loading}
          icon={<StatusIcon />}
          label="Change Status"
          hasDropdown
          isOpen={statusOpen}
        />
        {statusOpen && (
          <DropdownMenu>
            {ISSUE_STATE_OPTIONS.map((option) => (
              <DropdownItem
                key={option.value}
                onClick={() => handleStatusSelect(option.value)}
              >
                {option.label}
              </DropdownItem>
            ))}
          </DropdownMenu>
        )}
      </div>

      {/* Move to Week dropdown */}
      <div className="relative" ref={sprintRef}>
        <ActionButton
          onClick={() => { setStatusOpen(false); setAssigneeOpen(false); setProjectOpen(false); setSprintOpen(!sprintOpen); }}
          disabled={loading}
          icon={<SprintIcon />}
          label="Move to Week"
          hasDropdown
          isOpen={sprintOpen}
        />
        {sprintOpen && (
          <DropdownMenu>
            <DropdownItem onClick={() => handleSprintSelect(null)}>
              No Week
            </DropdownItem>
            {sprints.length > 0 && (
              <div className="my-1 h-px bg-border" />
            )}
            {sprints.map((sprint) => (
              <DropdownItem
                key={sprint.id}
                onClick={() => handleSprintSelect(sprint.id)}
              >
                {sprint.name}
              </DropdownItem>
            ))}
            {sprints.length === 0 && (
              <div className="px-3 py-2 text-xs text-muted">
                No weeks available
              </div>
            )}
          </DropdownMenu>
        )}
      </div>

      {/* Assign dropdown */}
      {onAssign && (
        <div className="relative" ref={assigneeRef}>
          <ActionButton
            onClick={() => { setStatusOpen(false); setSprintOpen(false); setProjectOpen(false); setAssigneeOpen(!assigneeOpen); }}
            disabled={loading}
            icon={<PersonIcon />}
            label="Assign"
            hasDropdown
            isOpen={assigneeOpen}
          />
          {assigneeOpen && (
            <DropdownMenu>
              <DropdownItem onClick={() => handleAssigneeSelect(null)}>
                Unassigned
              </DropdownItem>
              {teamMembers.length > 0 && (
                <div className="my-1 h-px bg-border" />
              )}
              {teamMembers.map((member) => (
                <DropdownItem
                  key={member.id}
                  onClick={() => handleAssigneeSelect(member.id)}
                >
                  {member.name}
                </DropdownItem>
              ))}
              {teamMembers.length === 0 && (
                <div className="px-3 py-2 text-xs text-muted">
                  No team members available
                </div>
              )}
            </DropdownMenu>
          )}
        </div>
      )}

      {/* Project dropdown */}
      {onAssignProject && (
        <div className="relative" ref={projectRef}>
          <ActionButton
            onClick={() => { setStatusOpen(false); setSprintOpen(false); setAssigneeOpen(false); setProjectOpen(!projectOpen); }}
            disabled={loading}
            icon={<FolderIcon />}
            label="Project"
            hasDropdown
            isOpen={projectOpen}
          />
          {projectOpen && (
            <DropdownMenu>
              <DropdownItem onClick={() => handleProjectSelect(null)}>
                No Project
              </DropdownItem>
              {projects.length > 0 && (
                <div className="my-1 h-px bg-border" />
              )}
              {projects.map((project) => (
                <DropdownItem
                  key={project.id}
                  onClick={() => handleProjectSelect(project.id)}
                >
                  {project.title}
                </DropdownItem>
              ))}
              {projects.length === 0 && (
                <div className="px-3 py-2 text-xs text-muted">
                  No projects available
                </div>
              )}
            </DropdownMenu>
          )}
        </div>
      )}

      {/* Delete button */}
      <ActionButton
        onClick={onDelete}
        disabled={loading}
        icon={<TrashIcon />}
        label="Delete"
        destructive
      />

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

interface ActionButtonProps {
  onClick: () => void;
  disabled?: boolean;
  icon: React.ReactNode;
  label: string;
  hasDropdown?: boolean;
  isOpen?: boolean;
  destructive?: boolean;
}

function ActionButton({
  onClick,
  disabled,
  icon,
  label,
  hasDropdown,
  isOpen,
  destructive,
}: ActionButtonProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-expanded={hasDropdown ? isOpen : undefined}
      aria-haspopup={hasDropdown ? 'menu' : undefined}
      className={cn(
        'flex items-center gap-1.5 rounded px-2.5 py-1.5 text-sm font-medium transition-colors',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        destructive
          ? 'text-red-400 hover:bg-red-500/10 hover:text-red-300'
          : 'text-muted hover:bg-border/50 hover:text-foreground'
      )}
    >
      <span className="h-4 w-4">{icon}</span>
      {label}
      {hasDropdown && (
        <ChevronIcon className={cn('h-3 w-3 transition-transform', isOpen && 'rotate-180')} />
      )}
    </button>
  );
}

function DropdownMenu({ children }: { children: React.ReactNode }) {
  return (
    <div
      role="menu"
      className={cn(
        'absolute top-full left-0 z-50 mt-1 min-w-[160px] rounded-lg border border-border',
        'bg-background shadow-lg py-1',
        'animate-in fade-in slide-in-from-top-1 duration-100'
      )}
    >
      {children}
    </div>
  );
}

function DropdownItem({
  onClick,
  children,
}: {
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      role="menuitem"
      onClick={onClick}
      className="w-full px-3 py-1.5 text-left text-sm text-foreground hover:bg-border/50 transition-colors"
    >
      {children}
    </button>
  );
}

// Icons
function StatusIcon() {
  return (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}

function SprintIcon() {
  return (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
    </svg>
  );
}

function PersonIcon() {
  return (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
    </svg>
  );
}

function FolderIcon() {
  return (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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

function ChevronIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
    </svg>
  );
}
