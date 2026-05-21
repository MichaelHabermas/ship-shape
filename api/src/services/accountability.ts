/**
 * Accountability Check Service
 *
 * Detects missing accountability items for a user:
 * 1. Missing standups for active sprints
 * 2. Sprints at/past start without plan
 * 3. Sprints at/past start date not 'started'
 * 4. Sprints at/past start with no issues
 * 5. Completed sprints without review (>1 business day)
 * 6. Projects where user is owner without plan
 * 7. Completed projects without retro
 *
 * Creates action_items issues just-in-time when missing is detected.
 */

import { pool } from '../db/client.js';
import { isBusinessDay } from '../utils/business-days.js';
import { hasContent } from '../utils/document-content.js';
import { getAllocations } from '../utils/allocation.js';
import type { AccountabilityType } from '@ship/shared';

// Accountability item returned from check
export interface MissingAccountabilityItem {
  type: AccountabilityType;
  targetId: string;
  targetTitle: string;
  targetType: 'sprint' | 'project';
  dueDate: string | null;
  message: string;
  daysSinceLastStandup?: number; // Only set for standup type
  issueCount?: number; // Number of issues assigned to user (for standup type)
  // Additional metadata for weekly_plan/weekly_review navigation
  personId?: string; // Current user's person document ID
  projectId?: string; // Project associated with the sprint
  weekNumber?: number; // Sprint/week number
}

// Created accountability issue
export interface AccountabilityIssue {
  id: string;
  title: string;
  ticketNumber: number;
  type: AccountabilityType;
  targetId: string;
  dueDate: string | null;
}

/**
 * Check for missing accountability items for a user in a workspace.
 * Returns list of items that need attention.
 */
export async function checkMissingAccountability(
  userId: string,
  workspaceId: string
): Promise<MissingAccountabilityItem[]> {
  const items: MissingAccountabilityItem[] = [];

  // Get workspace sprint_start_date to calculate sprint dates
  const workspaceResult = await pool.query(
    `SELECT sprint_start_date FROM workspaces WHERE id = $1`,
    [workspaceId]
  );

  if (workspaceResult.rows.length === 0) {
    return items;
  }

  const rawStartDate = workspaceResult.rows[0].sprint_start_date;
  const sprintDuration = 7;

  // Get current user's person document ID for weekly_plan navigation
  const personResult = await pool.query(
    `SELECT id FROM documents
     WHERE workspace_id = $1
       AND document_type = 'person'
       AND (properties->>'user_id')::uuid = $2`,
    [workspaceId, userId]
  );
  const personId = personResult.rows[0]?.id || null;

  // Parse workspace start date
  let workspaceStartDate: Date;
  if (rawStartDate instanceof Date) {
    workspaceStartDate = new Date(Date.UTC(rawStartDate.getFullYear(), rawStartDate.getMonth(), rawStartDate.getDate()));
  } else if (typeof rawStartDate === 'string') {
    workspaceStartDate = new Date(rawStartDate + 'T00:00:00Z');
  } else {
    workspaceStartDate = new Date();
  }

  // Calculate today and current sprint
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const todayStr = today.toISOString().split('T')[0];
  const daysSinceStart = Math.floor((today.getTime() - workspaceStartDate.getTime()) / (1000 * 60 * 60 * 24));
  const currentSprintNumber = Math.floor(daysSinceStart / sprintDuration) + 1;

  // Check for missing standups (current sprint, business days only)
  if (todayStr) {
    const standupItems = await checkMissingStandups(userId, workspaceId, currentSprintNumber, todayStr);
    items.push(...standupItems);
  }

  // Check sprint accountability: started status and issues
  if (todayStr) {
    const sprintItems = await checkSprintAccountability(
      userId, workspaceId, workspaceStartDate, sprintDuration, today, personId
    );
    items.push(...sprintItems);
  }

  // Check for per-person weekly_plan and weekly_retro (based on allocations)
  // Check both current sprint AND next sprint, since plans become due 2 days before
  // the sprint starts (Saturday before a Monday-start week).
  if (personId && todayStr) {
    const weeklyPersonItems = await checkWeeklyPersonAccountability(
      userId, workspaceId, personId, workspaceStartDate, sprintDuration, currentSprintNumber, todayStr
    );
    items.push(...weeklyPersonItems);

    // Also check next sprint - plan may be due before the sprint starts
    const nextSprintItems = await checkWeeklyPersonAccountability(
      userId, workspaceId, personId, workspaceStartDate, sprintDuration, currentSprintNumber + 1, todayStr
    );
    items.push(...nextSprintItems);
  }

  // Check for plans/retros where manager requested changes
  if (personId) {
    const changesRequestedItems = await checkChangesRequested(workspaceId, personId);
    items.push(...changesRequestedItems);
  }

  return items;
}

/**
 * Check for missing standups for active sprints where user has assigned issues.
 *
 * Note: This query starts from issues assigned to the user and joins to sprints.
 * This effectively SKIPS sprints with no members (no assigned issues) because
 * there are no issue rows to match. Users are only prompted for standups in
 * sprints where they're actually participating (have assigned issues).
 */
async function checkMissingStandups(
  userId: string,
  workspaceId: string,
  currentSprintNumber: number,
  todayStr: string
): Promise<MissingAccountabilityItem[]> {
  const items: MissingAccountabilityItem[] = [];

  // Only check on business days
  if (!isBusinessDay(todayStr)) {
    return items;
  }

  // Find active sprints where user has assigned issues with count
  // (This inherently skips empty sprints with no members)
  const activeSprintsResult = await pool.query(
    `SELECT s.id, s.title, s.properties, COUNT(i.id) as issue_count
     FROM documents i
     JOIN document_associations da ON da.document_id = i.id AND da.relationship_type = 'sprint'
     JOIN documents s ON s.id = da.related_id AND s.document_type = 'sprint'
     WHERE i.workspace_id = $1
       AND i.document_type = 'issue'
       AND (i.properties->>'assignee_id')::uuid = $2
       AND (s.properties->>'sprint_number')::int = $3
       AND s.deleted_at IS NULL
     GROUP BY s.id, s.title, s.properties`,
    [workspaceId, userId, currentSprintNumber]
  );

  // Check each sprint for missing standup today
  for (const sprint of activeSprintsResult.rows) {
    const standupResult = await pool.query(
      `SELECT id FROM documents
       WHERE workspace_id = $1
         AND document_type = 'standup'
         AND (properties->>'author_id')::uuid = $2
         AND parent_id = $3
         AND created_at >= $4::date
         AND created_at < ($4::date + interval '1 day')`,
      [workspaceId, userId, sprint.id, todayStr]
    );

    if (standupResult.rows.length === 0) {
      // Calculate days since last standup
      const lastStandupResult = await pool.query(
        `SELECT MAX(created_at::date) as last_standup_date
         FROM documents
         WHERE workspace_id = $1
           AND document_type = 'standup'
           AND (properties->>'author_id')::uuid = $2
           AND parent_id = $3`,
        [workspaceId, userId, sprint.id]
      );

      const lastStandupDate = lastStandupResult.rows[0]?.last_standup_date;
      let daysSinceLastStandup = 0;
      const sprintTitle = sprint.title || `Week ${sprint.properties?.sprint_number || 'N'}`;
      const issueCount = parseInt(sprint.issue_count, 10) || 0;

      // Format: "Post standup for {sprint_title} ({issue_count} issues)"
      let message = `Post standup for ${sprintTitle}`;
      if (issueCount > 0) {
        message += ` (${issueCount} issue${issueCount === 1 ? '' : 's'} assigned)`;
      }

      if (lastStandupDate) {
        const lastDate = new Date(lastStandupDate);
        const todayDate = new Date(todayStr);
        daysSinceLastStandup = Math.floor((todayDate.getTime() - lastDate.getTime()) / (1000 * 60 * 60 * 24));
        if (daysSinceLastStandup > 1) {
          message += ` - ${daysSinceLastStandup} days since last`;
        }
      }

      items.push({
        type: 'standup',
        targetId: sprint.id,
        targetTitle: sprintTitle,
        targetType: 'sprint',
        dueDate: todayStr,
        message,
        daysSinceLastStandup,
        issueCount,
      });
    }
  }

  return items;
}

/**
 * Check sprint accountability: hypothesis, started status, and issues.
 */
async function checkSprintAccountability(
  userId: string,
  workspaceId: string,
  workspaceStartDate: Date,
  sprintDuration: number,
  today: Date,
  _personId: string | null
): Promise<MissingAccountabilityItem[]> {
  const items: MissingAccountabilityItem[] = [];

  // Find sprints where user is owner (accountable) and sprint has started
  // Also get the project associated with each sprint (via document_associations)
  const sprintsResult = await pool.query(
    `SELECT s.id, s.title, s.properties, da.related_id as project_id
     FROM documents s
     LEFT JOIN document_associations da ON da.document_id = s.id AND da.relationship_type = 'project'
     WHERE s.workspace_id = $1
       AND s.document_type = 'sprint'
       AND (s.properties->>'owner_id')::uuid = $2
       AND s.deleted_at IS NULL
       AND s.archived_at IS NULL`,
    [workspaceId, userId]
  );

  for (const sprint of sprintsResult.rows) {
    const props = sprint.properties || {};
    const sprintNumber = props.sprint_number || 1;
    // Calculate sprint start date
    const sprintStartDate = new Date(workspaceStartDate);
    sprintStartDate.setUTCDate(sprintStartDate.getUTCDate() + (sprintNumber - 1) * sprintDuration);

    // Skip if sprint hasn't started yet
    if (today < sprintStartDate) {
      continue;
    }

    const sprintTitle = sprint.title || `Week ${sprintNumber}`;

    const sprintStartStr = sprintStartDate.toISOString().split('T')[0] || null;

    // NOTE: Sprint-level plan check REMOVED. Plans are now per-person weekly_plan documents,
    // checked by checkWeeklyPersonAccountability(). The old props.plan check on the sprint
    // document was generating false "Write plan" notifications even when plans existed.

    // Check if sprint hasn't been started (status !== 'active' or 'completed')
    if (props.status !== 'active' && props.status !== 'completed') {
      items.push({
        type: 'week_start',
        targetId: sprint.id,
        targetTitle: sprintTitle,
        targetType: 'sprint',
        dueDate: sprintStartStr,
        message: `Start ${sprintTitle}`,
      });
    }

    // Check if sprint has no issues
    const issueCountResult = await pool.query(
      `SELECT COUNT(*) as count
       FROM document_associations da
       JOIN documents d ON d.id = da.document_id
       WHERE da.related_id = $1
         AND da.relationship_type = 'sprint'
         AND d.document_type = 'issue'
         AND d.deleted_at IS NULL`,
      [sprint.id]
    );

    const issueCount = parseInt(issueCountResult.rows[0].count, 10);
    if (issueCount === 0) {
      items.push({
        type: 'week_issues',
        targetId: sprint.id,
        targetTitle: sprintTitle,
        targetType: 'sprint',
        dueDate: sprintStartStr,
        message: `Add issues to ${sprintTitle}`,
      });
    }
  }

  return items;
}

/**
 * Check for missing per-person weekly_plan and weekly_retro documents.
 *
 * Allocations are determined by having issues assigned in a sprint for a project.
 * For each allocation, check if weekly_plan/weekly_retro exists.
 *
 * Deadlines (aligned with heatmap calculateStatus):
 * - weekly_plan: due from Saturday (weekStart - 2), overdue from Tuesday (weekStart + 1)
 * - weekly_retro: due from Thursday (weekStart + 3), overdue from Saturday (weekStart + 5)
 */
async function checkWeeklyPersonAccountability(
  userId: string,
  workspaceId: string,
  personId: string,
  workspaceStartDate: Date,
  sprintDuration: number,
  sprintNumber: number,
  todayStr: string
): Promise<MissingAccountabilityItem[]> {
  const items: MissingAccountabilityItem[] = [];

  // Calculate sprint dates
  const sprintStartDate = new Date(workspaceStartDate);
  sprintStartDate.setUTCDate(sprintStartDate.getUTCDate() + (sprintNumber - 1) * sprintDuration);

  // Plan becomes actionable on Saturday before the week (weekStart - 2)
  const planDueDate = new Date(sprintStartDate);
  planDueDate.setUTCDate(planDueDate.getUTCDate() - 2);
  const planDueStr = planDueDate.toISOString().split('T')[0] || '';

  // Plan becomes overdue on Tuesday (weekStart + 1) — used for dueDate display
  const planOverdueDate = new Date(sprintStartDate);
  planOverdueDate.setUTCDate(planOverdueDate.getUTCDate() + 1);
  const planOverdueStr = planOverdueDate.toISOString().split('T')[0] || '';

  // Retro becomes actionable on Thursday (weekStart + 3)
  const retroActionableDate = new Date(sprintStartDate);
  retroActionableDate.setUTCDate(retroActionableDate.getUTCDate() + 3);
  const retroActionableStr = retroActionableDate.toISOString().split('T')[0] || '';

  // Retro is due by end of Friday (weekStart + 4) — matches grid's yellow window
  const retroDueDate = new Date(sprintStartDate);
  retroDueDate.setUTCDate(retroDueDate.getUTCDate() + 4);
  const retroDueStr = retroDueDate.toISOString().split('T')[0] || '';

  // Get ALL allocations for this person/sprint (explicit assignee_ids + issue-based).
  // Note: The heatmap only displays one allocation per person per week (display limit),
  // but action items must check all allocations so nothing gets missed.
  const allocations = await getAllocations(workspaceId, personId, userId, sprintNumber);

  for (const allocation of allocations) {
    const projectId = allocation.projectId;
    const projectName = allocation.projectName;

    // Check for missing weekly_plan (due from Saturday before the week starts)
    // A plan counts as "done" only if it has meaningful content (not just template headings)
    if (todayStr >= planDueStr) {
      const planResult = await pool.query(
        `SELECT id, content FROM documents
         WHERE workspace_id = $1
           AND document_type = 'weekly_plan'
           AND (properties->>'person_id') = $2
           AND (properties->>'week_number')::int = $3
           AND archived_at IS NULL
           AND deleted_at IS NULL`,
        [workspaceId, personId, sprintNumber]
      );

      const planDoc = planResult.rows[0];
      if (!planDoc || !hasContent(planDoc.content)) {
        items.push({
          type: 'weekly_plan',
          targetId: projectId,
          targetTitle: `Week ${sprintNumber} Plan - ${projectName}`,
          targetType: 'project',
          dueDate: todayStr >= planOverdueStr ? planOverdueStr : planDueStr,
          message: `Write week ${sprintNumber} plan for ${projectName}`,
          personId,
          projectId,
          weekNumber: sprintNumber,
        });
      }
    }

    // Check for missing weekly_retro (due from Thursday of the sprint week)
    // A retro counts as "done" only if it has meaningful content (not just template headings)
    if (todayStr >= retroActionableStr) {
      const retroResult = await pool.query(
        `SELECT id, content FROM documents
         WHERE workspace_id = $1
           AND document_type = 'weekly_retro'
           AND (properties->>'person_id') = $2
           AND (properties->>'week_number')::int = $3
           AND archived_at IS NULL
           AND deleted_at IS NULL`,
        [workspaceId, personId, sprintNumber]
      );

      const retroDoc = retroResult.rows[0];
      if (!retroDoc || !hasContent(retroDoc.content)) {
        items.push({
          type: 'weekly_retro',
          targetId: projectId,
          targetTitle: `Week ${sprintNumber} Retro - ${projectName}`,
          targetType: 'project',
          dueDate: retroDueStr,
          message: `Write week ${sprintNumber} retro for ${projectName}`,
          personId,
          projectId,
          weekNumber: sprintNumber,
        });
      }
    }
  }

  return items;
}

// checkProjectPlan REMOVED - replaced by weekly_plan documents per person/project/week.
// The old system checked properties.plan on project docs, but that field was never
// exposed in the UI and has been superseded by checkWeeklyPersonAccountability().

/**
 * Check for plans/retros where manager requested changes.
 * Looks at sprint documents where the person is allocated and
 * plan_approval.state or review_approval.state = 'changes_requested'.
 */
async function checkChangesRequested(
  workspaceId: string,
  personId: string
): Promise<MissingAccountabilityItem[]> {
  const items: MissingAccountabilityItem[] = [];

  // Find sprints where this person is allocated and changes are requested
  const result = await pool.query(
    `SELECT
       s.id as sprint_id,
       (s.properties->>'sprint_number')::int as sprint_number,
       s.properties->'plan_approval' as plan_approval,
       s.properties->'review_approval' as review_approval,
       s.title as sprint_title,
       da.related_id as project_id
     FROM documents s
     LEFT JOIN document_associations da ON da.document_id = s.id AND da.relationship_type = 'project'
     WHERE s.workspace_id = $1
       AND s.document_type = 'sprint'
       AND s.deleted_at IS NULL
       AND $2 = ANY(
         SELECT jsonb_array_elements_text(s.properties->'assignee_ids')
       )
       AND (
         s.properties->'plan_approval'->>'state' = 'changes_requested'
         OR s.properties->'review_approval'->>'state' = 'changes_requested'
       )`,
    [workspaceId, personId]
  );

  for (const row of result.rows) {
    const sprintNumber = row.sprint_number;

    // Check plan changes requested
    if (row.plan_approval?.state === 'changes_requested') {
      items.push({
        type: 'changes_requested_plan',
        targetId: row.sprint_id,
        targetTitle: `Week ${sprintNumber} Plan`,
        targetType: 'sprint',
        dueDate: null,
        message: `Changes requested on your Week ${sprintNumber} plan`,
        personId,
        projectId: row.project_id || undefined,
        weekNumber: sprintNumber,
      });
    }

    // Check retro changes requested
    if (row.review_approval?.state === 'changes_requested') {
      items.push({
        type: 'changes_requested_retro',
        targetId: row.sprint_id,
        targetTitle: `Week ${sprintNumber} Retro`,
        targetType: 'sprint',
        dueDate: null,
        message: `Changes requested on your Week ${sprintNumber} retro`,
        personId,
        projectId: row.project_id || undefined,
        weekNumber: sprintNumber,
      });
    }
  }

  return items;
}

// NOTE: createAccountabilityIssue, checkAndCreateAccountabilityIssues, and
// autoCompleteAccountabilityIssue have been removed. Accountability is now
// computed via inference using checkMissingAccountability() - no issues are
// created or completed.
