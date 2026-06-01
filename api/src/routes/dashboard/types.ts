import { computeICEScore } from '@ship/shared';

export type WorkspaceSprintStartRow = {
  sprint_start_date: Date | string | null;
};

export type DashboardIssueProperties = {
  state?: string;
  priority?: string;
};

export type DashboardIssueRow = {
  id: string;
  title: string;
  properties: DashboardIssueProperties | null;
  ticket_number: number | null;
  sprint_id: string | null;
  sprint_name: string | null;
  sprint_number: number | null;
  program_name: string | null;
};

export type DashboardProjectProperties = {
  impact?: number | null;
  confidence?: number | null;
  ease?: number | null;
};

export type DashboardProjectRow = {
  id: string;
  title: string;
  properties: DashboardProjectProperties | null;
  program_name: string | null;
  inferred_status: string;
};

export type DashboardSprintProperties = {
  sprint_number?: number | string | null;
};

export type DashboardSprintRow = {
  id: string;
  title: string;
  properties: DashboardSprintProperties | null;
  program_name: string | null;
  sprint_number: number | null;
};

export type PersonLookupRow = {
  id: string;
  title: string;
};

export type FocusAllocationRow = {
  project_id: string;
  project_title: string;
  program_name: string | null;
};

export type WeeklyPlanRow = {
  id: string;
  content: unknown;
  properties: {
    project_id?: string;
    week_number?: number | string;
  } | null;
};

export type FocusActivityRow = {
  id: string;
  title: string;
  ticket_number: number;
  state: string;
  updated_at: string;
  project_id: string;
};

export type MyWeekContextRow = {
  person_id: string | null;
  person_name: string | null;
  sprint_start_date: Date | string | null;
};

export type WeeklyDocRow = {
  id: string;
  title: string;
  content: unknown;
  properties: {
    week_number?: number | string;
    submitted_at?: string | null;
  } | null;
  document_type: string;
  created_at: Date;
  updated_at: Date;
};

export type StandupDocRow = {
  id: string;
  title: string;
  properties: {
    date?: string;
  } | null;
  created_at: string;
};

export function extractDashboardIssueWorkItem(
  row: DashboardIssueRow,
  currentSprintNumber: number
): WorkItem {
  const props = row.properties || {};
  const sprintNumber = row.sprint_number;

  let urgency: Urgency = 'later';
  if (sprintNumber) {
    if (sprintNumber < currentSprintNumber) {
      urgency = 'overdue';
    } else if (sprintNumber === currentSprintNumber) {
      urgency = 'this_sprint';
    }
  }

  return {
    id: row.id,
    title: row.title,
    type: 'issue',
    urgency,
    state: props.state || 'backlog',
    priority: props.priority || 'medium',
    ticket_number: row.ticket_number ?? undefined,
    sprint_id: row.sprint_id,
    sprint_name: row.sprint_name,
    program_name: row.program_name,
  };
}

export function extractDashboardProjectWorkItem(row: DashboardProjectRow): WorkItem {
  const props = row.properties || {};
  const impact = props.impact !== undefined ? props.impact : null;
  const confidence = props.confidence !== undefined ? props.confidence : null;
  const ease = props.ease !== undefined ? props.ease : null;

  let urgency: Urgency = 'later';
  if (row.inferred_status === 'active') {
    urgency = 'this_sprint';
  }

  return {
    id: row.id,
    title: row.title,
    type: 'project',
    urgency,
    ice_score: computeICEScore(impact, confidence, ease),
    inferred_status: row.inferred_status,
    program_name: row.program_name,
  };
}

export function extractDashboardSprintWorkItem(
  row: DashboardSprintRow,
  daysRemaining: number
): WorkItem {
  return {
    id: row.id,
    title: row.title || `Week ${row.sprint_number}`,
    type: 'sprint',
    urgency: 'this_sprint',
    sprint_number: row.sprint_number ?? undefined,
    days_remaining: daysRemaining,
    program_name: row.program_name,
  };
}

// Urgency levels for work items
export type Urgency = 'overdue' | 'this_sprint' | 'later';

export interface WorkItem {
  id: string;
  title: string;
  type: 'issue' | 'project' | 'sprint';
  urgency: Urgency;
  // Issue-specific
  state?: string;
  priority?: string;
  ticket_number?: number;
  sprint_id?: string | null;
  sprint_name?: string | null;
  // Project-specific
  ice_score?: number | null;
  inferred_status?: string;
  // Sprint-specific
  sprint_number?: number;
  days_remaining?: number;
  // Common
  program_name?: string | null;
}