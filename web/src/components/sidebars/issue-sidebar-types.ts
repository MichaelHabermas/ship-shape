// Issue sidebar form state and props; mirrors issue document fields shown in the properties panel.
import type { BelongsTo, PublicIssueExternalLink } from '@ship/shared';

export interface Issue {
  id: string;
  state: string;
  priority: string;
  estimate: number | null;
  assignee_id: string | null;
  assignee_name?: string | null;
  assignee_archived?: boolean;
  source?: 'internal' | 'external';
  rejection_reason?: string | null;
  converted_from_id?: string | null;
  /** Multi-parent associations via junction table */
  belongs_to?: BelongsTo[];
  external_links?: PublicIssueExternalLink[];
}

export interface IssueIteration {
  id: string;
  status: 'pass' | 'fail' | 'in_progress';
  what_attempted: string | null;
  blockers_encountered: string | null;
  author: {
    id: string;
    name: string;
    email: string;
  };
  created_at: string;
}

export interface TeamMember {
  id: string;
  user_id: string;
  name: string;
}

export interface Program {
  id: string;
  name: string;
  color?: string;
}

export interface Project {
  id: string;
  title: string;
  color?: string;
}

export interface Sprint {
  id: string;
  name: string;
  status: string;
  sprint_number: number;
}

export interface IssueSidebarProps {
  issue: Issue;
  teamMembers: TeamMember[];
  programs: Program[];
  /** Available projects for multi-association */
  projects?: Project[];
  onUpdate: (updates: Partial<Issue>) => Promise<void>;
  /** Called after an association is added/removed via API */
  onAssociationChange?: () => void;
  onConvert?: () => void;
  onUndoConversion?: () => void;
  onAccept?: () => Promise<void>;
  onReject?: (reason: string) => Promise<void>;
  isConverting?: boolean;
  isUndoing?: boolean;
  /** Fields to highlight as missing (e.g., after type conversion) */
  highlightedFields?: string[];
}

// Compute sprint dates from sprint number (1-week sprints)
export function computeSprintDates(sprintNumber: number, workspaceStartDate: Date): { start: Date; end: Date } {
  const start = new Date(workspaceStartDate);
  start.setDate(start.getDate() + (sprintNumber - 1) * 7);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}
