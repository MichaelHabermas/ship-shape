// Verifies FleetGraph candidate detection against real Ship tables.
import { randomUUID } from 'crypto';
import { describe, expect, it } from 'vitest';
import { pool } from '../db/client.js';
import { requireFirstRow } from '../utils/query-rows.js';
import {
  detectBlockedImportantIssueDecisions,
  findBlockedImportantIssueQuietExits,
  recordBlockedImportantIssueQuietExitRun,
} from './detector.js';
import { saveBlockedImportantIssueFinding } from './persistence.js';
import { runManualFleetGraphDetector } from './manual-detector.js';

async function createWorkspace(): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO workspaces (name, sprint_start_date)
     VALUES ($1, $2)
     RETURNING id`,
    [`FleetGraph detector ${randomUUID()}`, '2026-05-18']
  );

  return requireFirstRow(result.rows).id;
}

async function createUser(): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO users (email, name)
     VALUES ($1, $2)
     RETURNING id`,
    [`fleetgraph-detector-${randomUUID()}@example.com`, 'FleetGraph Detector']
  );

  return requireFirstRow(result.rows).id;
}

async function createDocument(input: {
  workspaceId: string;
  type: 'issue' | 'sprint';
  title: string;
  properties: Record<string, unknown>;
  deleted?: boolean;
  archived?: boolean;
}): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO documents (workspace_id, document_type, title, properties, deleted_at, archived_at)
     VALUES ($1, $2, $3, $4::jsonb, $5, $6)
     RETURNING id`,
    [
      input.workspaceId,
      input.type,
      input.title,
      JSON.stringify(input.properties),
      input.deleted ? new Date('2026-05-26T12:00:00Z') : null,
      input.archived ? new Date('2026-05-26T12:00:00Z') : null,
    ]
  );

  return requireFirstRow(result.rows).id;
}

async function associateIssueToSprint(issueId: string, sprintId: string): Promise<void> {
  await pool.query(
    `INSERT INTO document_associations (document_id, related_id, relationship_type)
     VALUES ($1, $2, 'sprint')`,
    [issueId, sprintId]
  );
}

async function createIteration(input: {
  issueId: string;
  workspaceId: string;
  authorId: string;
  blockerText: string | null;
  createdAt?: string;
}): Promise<void> {
  await pool.query(
    `INSERT INTO issue_iterations
     (issue_id, workspace_id, status, what_attempted, blockers_encountered, author_id, created_at)
     VALUES ($1, $2, 'in_progress', $3, $4, $5, $6)`,
    [
      input.issueId,
      input.workspaceId,
      'Tried current work',
      input.blockerText,
      input.authorId,
      input.createdAt ? new Date(input.createdAt) : new Date('2026-05-26T12:00:00Z'),
    ]
  );
}

async function readDetectorTableCounts(workspaceId: string, userId: string): Promise<Record<string, string>> {
  const result = await pool.query<Record<string, string>>(
    `SELECT
       (SELECT COUNT(*)::text FROM workspaces WHERE id = $1) AS workspaces,
       (SELECT COUNT(*)::text FROM users WHERE id = $2) AS users,
       (SELECT COUNT(*)::text FROM documents WHERE workspace_id = $1) AS documents,
       (SELECT COUNT(*)::text
          FROM document_associations association
          JOIN documents document ON document.id = association.document_id
         WHERE document.workspace_id = $1) AS document_associations,
       (SELECT COUNT(*)::text FROM issue_iterations WHERE workspace_id = $1) AS issue_iterations,
       (SELECT COUNT(*)::text FROM fleetgraph_findings WHERE workspace_id = $1) AS fleetgraph_findings,
       (SELECT COUNT(*)::text FROM fleetgraph_runs WHERE workspace_id = $1) AS fleetgraph_runs`,
    [workspaceId, userId]
  );

  return requireFirstRow(result.rows);
}

describe('FleetGraph detector database query', () => {
  it('finds a blocked urgent active-week issue deterministically', async () => {
    const workspaceId = await createWorkspace();
    const userId = await createUser();
    const sprintId = await createDocument({
      workspaceId,
      type: 'sprint',
      title: 'Week 2',
      properties: { sprint_number: 2, owner_id: userId },
    });
    const issueId = await createDocument({
      workspaceId,
      type: 'issue',
      title: 'Blocked launch issue',
      properties: { state: 'in_progress', priority: 'urgent', assignee_id: userId },
    });

    await associateIssueToSprint(issueId, sprintId);
    await createIteration({
      issueId,
      workspaceId,
      authorId: userId,
      blockerText: 'Waiting on API credentials.',
    });

    const batch = await detectBlockedImportantIssueDecisions({
      workspaceId,
      today: new Date('2026-05-26T12:00:00Z'),
    });

    expect(batch.decisions.map((decision) => decision.candidate)).toEqual([
      expect.objectContaining({
        workspace_id: workspaceId,
        issue_id: issueId,
        issue_title: 'Blocked launch issue',
        issue_priority: 'urgent',
        sprint_id: sprintId,
        sprint_number: 2,
        blocker_text: 'Waiting on API credentials.',
        dedupeKey: `blocked-important-issue:${workspaceId}:${issueId}:${sprintId}`,
      }),
    ]);
  });

  it('plans update on rerun when an open finding already exists', async () => {
    const workspaceId = await createWorkspace();
    const userId = await createUser();
    const sprintId = await createDocument({
      workspaceId,
      type: 'sprint',
      title: 'Week 2',
      properties: { sprint_number: 2, owner_id: userId },
    });
    const issueId = await createDocument({
      workspaceId,
      type: 'issue',
      title: 'Repeated blocked issue',
      properties: { state: 'in_progress', priority: 'high', assignee_id: userId },
    });

    await associateIssueToSprint(issueId, sprintId);
    await createIteration({
      issueId,
      workspaceId,
      authorId: userId,
      blockerText: 'Blocked on access review.',
    });
    const existingFinding = await saveBlockedImportantIssueFinding({
      workspaceId,
      sourceIssueId: issueId,
      sourceSprintId: sprintId,
      severity: 'high',
      confidence: 0.8,
      title: 'Repeated blocked issue',
      summary: 'Issue has a blocker in the active week.',
    });

    const batch = await detectBlockedImportantIssueDecisions({
      workspaceId,
      today: new Date('2026-05-26T12:00:00Z'),
    });

    expect(batch.decisions).toEqual([
      expect.objectContaining({
        decision: 'update_finding',
        existingFindingId: existingFinding.id,
        candidate: expect.objectContaining({
          issue_id: issueId,
          sprint_id: sprintId,
          dedupeKey: existingFinding.dedupe_key,
        }),
      }),
    ]);

    const count = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
         FROM fleetgraph_findings
        WHERE dedupe_key = $1
          AND status IN ('open', 'needs_confirmation', 'error')`,
      [existingFinding.dedupe_key]
    );
    expect(count.rows[0]?.count).toBe('1');
  });

  it('excludes non-qualifying issues from positive candidate selection', async () => {
    const workspaceId = await createWorkspace();
    const userId = await createUser();
    const activeSprintId = await createDocument({
      workspaceId,
      type: 'sprint',
      title: 'Week 2',
      properties: { sprint_number: 2, owner_id: userId },
    });
    const inactiveSprintId = await createDocument({
      workspaceId,
      type: 'sprint',
      title: 'Week 1',
      properties: { sprint_number: 1, owner_id: userId },
    });
    const ownerlessSprintId = await createDocument({
      workspaceId,
      type: 'sprint',
      title: 'Week 2 ownerless',
      properties: { sprint_number: 2 },
    });

    async function issue(input: {
      title: string;
      properties: Record<string, unknown>;
      sprintId?: string;
      blockerText?: string | null;
      deleted?: boolean;
      archived?: boolean;
      olderBlockerThenBlank?: boolean;
    }): Promise<string> {
      const issueId = await createDocument({
        workspaceId,
        type: 'issue',
        title: input.title,
        properties: input.properties,
      });
      await associateIssueToSprint(issueId, input.sprintId ?? activeSprintId);
      if (input.deleted || input.archived) {
        await pool.query(
          `UPDATE documents
              SET deleted_at = COALESCE($2, deleted_at),
                  archived_at = COALESCE($3, archived_at)
            WHERE id = $1`,
          [
            issueId,
            input.deleted ? new Date('2026-05-26T12:00:00Z') : null,
            input.archived ? new Date('2026-05-26T12:00:00Z') : null,
          ]
        );
      }
      if (input.olderBlockerThenBlank) {
        await createIteration({
          issueId,
          workspaceId,
          authorId: userId,
          blockerText: 'Old blocker',
          createdAt: '2026-05-25T12:00:00Z',
        });
        await createIteration({
          issueId,
          workspaceId,
          authorId: userId,
          blockerText: '',
          createdAt: '2026-05-26T12:00:00Z',
        });
      } else {
        await createIteration({
          issueId,
          workspaceId,
          authorId: userId,
          blockerText: input.blockerText ?? 'Waiting on API credentials.',
        });
      }
      return issueId;
    }

    const qualifyingIssueId = await issue({
      title: 'Only qualifying issue',
      properties: { state: 'in_progress', priority: 'urgent', assignee_id: userId },
    });
    await issue({
      title: 'Inactive week',
      sprintId: inactiveSprintId,
      properties: { state: 'in_progress', priority: 'urgent', assignee_id: userId },
    });
    await issue({
      title: 'Medium priority',
      properties: { state: 'in_progress', priority: 'medium', assignee_id: userId },
    });
    await issue({
      title: 'Done issue',
      properties: { state: 'done', priority: 'urgent', assignee_id: userId },
    });
    await issue({
      title: 'No latest blocker',
      properties: { state: 'in_progress', priority: 'urgent', assignee_id: userId },
      blockerText: '',
    });
    await issue({
      title: 'Missing fallback owner',
      sprintId: ownerlessSprintId,
      properties: { state: 'in_progress', priority: 'urgent' },
    });
    await issue({
      title: 'Deleted issue',
      properties: { state: 'in_progress', priority: 'urgent', assignee_id: userId },
      deleted: true,
    });
    await issue({
      title: 'Archived issue',
      properties: { state: 'in_progress', priority: 'urgent', assignee_id: userId },
      archived: true,
    });
    await issue({
      title: 'Latest iteration cleared blocker',
      properties: { state: 'in_progress', priority: 'urgent', assignee_id: userId },
      olderBlockerThenBlank: true,
    });

    const batch = await detectBlockedImportantIssueDecisions({
      workspaceId,
      today: new Date('2026-05-26T12:00:00Z'),
    });

    expect(batch.decisions.map((decision) => decision.candidate.issue_id)).toEqual([qualifyingIssueId]);
  });

  it('ignores malformed sprint numbers instead of aborting the detector', async () => {
    const workspaceId = await createWorkspace();
    const userId = await createUser();
    const sprintId = await createDocument({
      workspaceId,
      type: 'sprint',
      title: 'Malformed week',
      properties: { sprint_number: 'Week 2', owner_id: userId },
    });
    const issueId = await createDocument({
      workspaceId,
      type: 'issue',
      title: 'Malformed sprint issue',
      properties: { state: 'in_progress', priority: 'urgent', assignee_id: userId },
    });
    await associateIssueToSprint(issueId, sprintId);
    await createIteration({
      issueId,
      workspaceId,
      authorId: userId,
      blockerText: 'Waiting on API credentials.',
    });

    await expect(detectBlockedImportantIssueDecisions({
      workspaceId,
      today: new Date('2026-05-26T12:00:00Z'),
    })).resolves.toEqual({ decisions: [] });
  });

  it('classifies quiet exits against real Ship rows', async () => {
    const workspaceId = await createWorkspace();
    const userId = await createUser();
    const activeSprintId = await createDocument({
      workspaceId,
      type: 'sprint',
      title: 'Week 2',
      properties: { sprint_number: 2, owner_id: userId },
    });
    const ownerlessSprintId = await createDocument({
      workspaceId,
      type: 'sprint',
      title: 'Week 2 ownerless',
      properties: { sprint_number: 2 },
    });
    const inactiveSprintId = await createDocument({
      workspaceId,
      type: 'sprint',
      title: 'Week 1',
      properties: { sprint_number: 1, owner_id: userId },
    });

    async function quietIssue(input: {
      title: string;
      properties: Record<string, unknown>;
      sprintId?: string;
      blockerText?: string | null;
    }): Promise<string> {
      const issueId = await createDocument({
        workspaceId,
        type: 'issue',
        title: input.title,
        properties: input.properties,
      });
      await associateIssueToSprint(issueId, input.sprintId ?? activeSprintId);
      await createIteration({
        issueId,
        workspaceId,
        authorId: userId,
        blockerText: input.blockerText ?? 'Waiting on API credentials.',
      });
      return issueId;
    }

    await quietIssue({
      title: 'Inactive week',
      sprintId: inactiveSprintId,
      properties: { state: 'in_progress', priority: 'urgent', assignee_id: userId },
    });
    await quietIssue({
      title: 'No blocker',
      properties: { state: 'in_progress', priority: 'urgent', assignee_id: userId },
      blockerText: '',
    });
    await quietIssue({
      title: 'Medium priority',
      properties: { state: 'in_progress', priority: 'medium', assignee_id: userId },
    });
    await quietIssue({
      title: 'Done issue',
      properties: { state: 'done', priority: 'urgent', assignee_id: userId },
    });
    await quietIssue({
      title: 'Missing fallback owner',
      sprintId: ownerlessSprintId,
      properties: { state: 'in_progress', priority: 'urgent' },
    });
    const duplicateIssueId = await quietIssue({
      title: 'Duplicate finding',
      properties: { state: 'in_progress', priority: 'urgent', assignee_id: userId },
    });
    await saveBlockedImportantIssueFinding({
      workspaceId,
      sourceIssueId: duplicateIssueId,
      sourceSprintId: activeSprintId,
      severity: 'high',
      confidence: 0.8,
      title: 'Duplicate finding',
      summary: 'Issue already has an open FleetGraph finding.',
    });

    const quietExits = await findBlockedImportantIssueQuietExits({
      workspaceId,
      today: new Date('2026-05-26T12:00:00Z'),
    });

    expect(quietExits).toEqual([
      { reason: 'done_or_cancelled', count: 1 },
      { reason: 'duplicate_open_finding', count: 1 },
      { reason: 'inactive_week', count: 1 },
      { reason: 'insufficient_visible_evidence', count: 0 },
      { reason: 'medium_low_priority', count: 1 },
      { reason: 'missing_fallback_owner', count: 1 },
      { reason: 'no_blocker', count: 1 },
    ]);
  });

  it('records quiet exits without creating findings', async () => {
    const workspaceId = await createWorkspace();

    await recordBlockedImportantIssueQuietExitRun({
      workspaceId,
      quietExits: [{ reason: 'insufficient_visible_evidence', count: 0 }],
    });

    const runs = await pool.query<{ count: string; token_metadata: Record<string, unknown>; cost_metadata: Record<string, unknown> }>(
      `SELECT COUNT(*)::text AS count,
              MAX(token_metadata::text)::jsonb AS token_metadata,
              MAX(cost_metadata::text)::jsonb AS cost_metadata
         FROM fleetgraph_runs
        WHERE workspace_id = $1
          AND decision = 'quiet_exit'`,
      [workspaceId]
    );
    const findings = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
         FROM fleetgraph_findings
        WHERE workspace_id = $1`,
      [workspaceId]
    );

    expect(runs.rows[0]?.count).toBe('1');
    expect(runs.rows[0]?.token_metadata).toEqual({ modelCalls: 0 });
    expect(runs.rows[0]?.cost_metadata).toEqual({ modelCostUsd: 0 });
    expect(findings.rows[0]?.count).toBe('0');
  });

  it('runs the manual detector without writing FleetGraph or Ship records', async () => {
    const workspaceId = await createWorkspace();
    const userId = await createUser();
    const sprintId = await createDocument({
      workspaceId,
      type: 'sprint',
      title: 'Week 2',
      properties: { sprint_number: 2, owner_id: userId },
    });
    const issueId = await createDocument({
      workspaceId,
      type: 'issue',
      title: 'Manual detector issue',
      properties: { state: 'in_progress', priority: 'urgent', assignee_id: userId },
    });
    await associateIssueToSprint(issueId, sprintId);
    await createIteration({
      issueId,
      workspaceId,
      authorId: userId,
      blockerText: 'Waiting on API credentials.',
    });

    const beforeCounts = await readDetectorTableCounts(workspaceId, userId);

    const summary = await runManualFleetGraphDetector({
      workspaceId,
      today: new Date('2026-05-26T12:00:00Z'),
    });

    const afterCounts = await readDetectorTableCounts(workspaceId, userId);

    expect(summary.candidateCount).toBe(1);
    expect(summary.modelCalls).toBe(0);
    expect(summary.mutatesShip).toBe(false);
    expect(summary.mutatesFleetGraph).toBe(false);
    expect(afterCounts).toEqual(beforeCounts);
  });
});
