// Week routes expose sprint document workflows and visibility-filtered rollups.
import type { PlanHistoryEntry } from '@ship/shared';
import { pool } from '../../../db/client.js';
import { z } from 'zod';
import { VISIBILITY_FILTER_SQL } from '../../../middleware/visibility.js';
import { formatWireDate } from '../../../utils/format-wire-date.js';
import { visibleAssociatedIssueCountSql } from '../../../services/document-graph-visibility.js';
import type {
  SprintRow,
  SprintIssueIdRow,
} from '../types.js';

export function visibleSprintIssueCountSql(
  userIdParam: string,
  isAdminParam: string,
  issueFilter = 'TRUE'
): string {
  return visibleAssociatedIssueCountSql('i', 'sprint', 'd', userIdParam, isAdminParam, issueFilter);
}

// Validation schemas
// Sprint properties: sprint_number, assignee_ids (array), and plan fields
// API accepts owner_id for backwards compatibility, stored internally as assignee_ids[0]
// Dates and status are computed from sprint_number + workspace.sprint_start_date
// program_id is optional - sprints can be projectless (ad-hoc work)
export const createSprintSchema = z.object({
  program_id: z.string().uuid().optional().nullable(),
  title: z.string().min(1).max(200).optional().default('Untitled'),
  sprint_number: z.number().int().positive(),
  owner_id: z.string().uuid().optional(),
  // Plan tracking (optional at creation) - what will we learn/validate?
  plan: z.string().max(2000).optional(),
  success_criteria: z.array(z.string().max(500)).max(20).optional(),
  confidence: z.number().int().min(0).max(100).optional(),
});

export const updateSprintSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  owner_id: z.string().uuid().optional().nullable(), // Allow clearing owner
  sprint_number: z.number().int().positive().optional(),
});

// Separate schema for plan updates (append mode)
export const updatePlanSchema = z.object({
  plan: z.string().max(2000).optional(),
  success_criteria: z.array(z.string().max(500)).max(20).optional(),
  confidence: z.number().int().min(0).max(100).optional(),
});

// Helper to extract sprint from row
// Dates and status are computed on frontend from sprint_number + workspace.sprint_start_date
export function extractSprintFromRow(row: SprintRow) {
  const props = row.properties || {};
  return {
    id: row.id,
    name: row.title,
    sprint_number: props.sprint_number || 1,
    status: props.status || 'planning',  // Default to 'planning' for sprints without status
    owner: row.owner_id ? {
      id: row.owner_id,
      name: row.owner_name,
      email: row.owner_email,
    } : null,
    program_id: row.program_id,
    program_name: row.program_name,
    program_prefix: row.program_prefix,
    program_accountable_id: row.program_accountable_id || null,
    owner_reports_to: row.owner_reports_to || null,
    workspace_sprint_start_date: formatWireDate(row.workspace_sprint_start_date),
    issue_count: parseInt(String(row.issue_count || 0), 10) || 0,
    completed_count: parseInt(String(row.completed_count || 0), 10) || 0,
    started_count: parseInt(String(row.started_count || 0), 10) || 0,
    has_plan: row.has_plan === true || row.has_plan === 't',
    has_retro: row.has_retro === true || row.has_retro === 't',
    // Retro outcome summary (populated if retro exists)
    retro_outcome: row.retro_outcome || null,
    retro_id: row.retro_id || null,
    // Plan tracking fields - what will we learn/validate?
    plan: props.plan || null,
    success_criteria: props.success_criteria || null,
    confidence: typeof props.confidence === 'number' ? props.confidence : null,
    plan_history: props.plan_history || null,
    // Completeness flags
    is_complete: props.is_complete ?? null,
    missing_fields: props.missing_fields ?? [],
    // Plan snapshot (populated when sprint becomes active)
    planned_issue_ids: props.planned_issue_ids || null,
    snapshot_taken_at: props.snapshot_taken_at || null,
    // Approval tracking
    plan_approval: props.plan_approval || null,
    review_approval: props.review_approval || null,
    // Performance rating (OPM 5-level scale)
    review_rating: props.review_rating || null,
    // Accountability (sprints inherit from program, but may have direct assignment)
    accountable_id: props.accountable_id || null,
  };
}

// Calculate sprint dates from sprint_number and workspace start date
export function calculateSprintDates(sprintNumber: number, workspaceStartDate: Date | string): { startDate: Date; endDate: Date } {
  const sprintDuration = 7; // 7-day sprints

  let baseDate: Date;
  if (workspaceStartDate instanceof Date) {
    baseDate = new Date(Date.UTC(workspaceStartDate.getFullYear(), workspaceStartDate.getMonth(), workspaceStartDate.getDate()));
  } else if (typeof workspaceStartDate === 'string') {
    baseDate = new Date(workspaceStartDate + 'T00:00:00Z');
  } else {
    baseDate = new Date();
  }

  const startDate = new Date(baseDate);
  startDate.setUTCDate(startDate.getUTCDate() + (sprintNumber - 1) * sprintDuration);

  const endDate = new Date(startDate);
  endDate.setUTCDate(endDate.getUTCDate() + sprintDuration - 1);

  return { startDate, endDate };
}

// Check if sprint is active (start_date has passed)
export function isSprintActive(sprintNumber: number, workspaceStartDate: Date | string): boolean {
  const { startDate } = calculateSprintDates(sprintNumber, workspaceStartDate);
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  return today >= startDate;
}

// Take a snapshot of issues visible to the actor in the sprint
export async function takeSprintSnapshot(
  sprintId: string,
  userId: string,
  isAdmin: boolean
): Promise<string[]> {
  const result = await pool.query<SprintIssueIdRow>(
    `SELECT d.id FROM documents d
     JOIN document_associations da ON da.document_id = d.id
     WHERE da.related_id = $1 AND da.relationship_type = 'sprint' AND d.document_type = 'issue'
       AND ${VISIBILITY_FILTER_SQL('d', '$2', '$3')}`,
    [sprintId, userId, isAdmin]
  );
  return result.rows.map(row => row.id);
}
