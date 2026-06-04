import { ReactElement } from 'react';
import { ProjectCombobox, Project } from '@/components/ProjectCombobox';
import { cn } from '@/lib/cn';
import type { TeamAssignment } from '@/api/schemas';

export function SprintCell({
  assignment,
  previousWeekAssignment,
  projects,
  isCurrent,
  loading,
  isPending,
  onChange,
  onNavigate,
}: {
  assignment?: TeamAssignment;
  previousWeekAssignment?: TeamAssignment;
  projects: Project[];
  isCurrent: boolean;
  loading: boolean;
  isPending?: boolean;
  onChange: (projectId: string | null) => void;
  onNavigate: (projectId: string) => void;
}): ReactElement {
  // Convert previous week assignment to Project format for the quick select
  const previousWeekProject: Project | null =
    previousWeekAssignment?.projectId && previousWeekAssignment?.projectName
      ? {
          id: previousWeekAssignment.projectId,
          title: previousWeekAssignment.projectName,
          color: previousWeekAssignment.projectColor,
          programId: previousWeekAssignment.programId,
          programName: previousWeekAssignment.programName,
          programEmoji: previousWeekAssignment.emoji,
          programColor: previousWeekAssignment.color,
        }
      : null;

  // isPending is only used for visual styling (dashed border), not for blocking assignment
  return (
    <div
      className={cn(
        'flex h-12 w-[180px] items-center justify-start border-b border-r border-border px-1',
        isCurrent && 'bg-accent/5',
        loading && 'animate-pulse',
        isPending && 'border-dashed'
      )}
    >
      <ProjectCombobox
        projects={projects}
        value={assignment?.projectId || null}
        onChange={onChange}
        onNavigate={onNavigate}
        disabled={loading}
        placeholder="+"
        previousWeekProject={previousWeekProject}
        triggerClassName={cn(
          'w-full h-full justify-start',
          !assignment && 'hover:bg-border/30'
        )}
      />
    </div>
  );
}
