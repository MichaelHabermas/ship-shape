// Verifies FleetGraph candidate detection against real Ship tables.
import { randomUUID } from 'crypto';
import { describe, expect, it } from 'vitest';
import { pool } from '../db/client.js';
import { requireFirstRow } from '../utils/query-rows.js';
import {
  findBlockedImportantIssueCandidates,
  planBlockedImportantIssueDedupeDecisions,
} from './detector.js';
import { saveBlockedImportantIssueFinding } from './persistence.js';

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
}): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO documents (workspace_id, document_type, title, properties)
     VALUES ($1, $2, $3, $4::jsonb)
     RETURNING id`,
    [input.workspaceId, input.type, input.title, JSON.stringify(input.properties)]
  );

  return requireFirstRow(result.rows).id;
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

    await pool.query(
      `INSERT INTO document_associations (document_id, related_id, relationship_type)
       VALUES ($1, $2, 'sprint')`,
      [issueId, sprintId]
    );
    await pool.query(
      `INSERT INTO issue_iterations
       (issue_id, workspace_id, status, what_attempted, blockers_encountered, author_id)
       VALUES ($1, $2, 'in_progress', $3, $4, $5)`,
      [issueId, workspaceId, 'Tried deploy', 'Waiting on API credentials.', userId]
    );

    const candidates = await findBlockedImportantIssueCandidates({
      workspaceId,
      today: new Date('2026-05-26T12:00:00Z'),
    });

    expect(candidates).toEqual([
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

    await pool.query(
      `INSERT INTO document_associations (document_id, related_id, relationship_type)
       VALUES ($1, $2, 'sprint')`,
      [issueId, sprintId]
    );
    await pool.query(
      `INSERT INTO issue_iterations
       (issue_id, workspace_id, status, what_attempted, blockers_encountered, author_id)
       VALUES ($1, $2, 'in_progress', $3, $4, $5)`,
      [issueId, workspaceId, 'Tried repro', 'Blocked on access review.', userId]
    );
    const existingFinding = await saveBlockedImportantIssueFinding({
      workspaceId,
      sourceIssueId: issueId,
      sourceSprintId: sprintId,
      severity: 'high',
      confidence: 0.8,
      title: 'Repeated blocked issue',
      summary: 'Issue has a blocker in the active week.',
    });

    const candidates = await findBlockedImportantIssueCandidates({
      workspaceId,
      today: new Date('2026-05-26T12:00:00Z'),
    });
    const decisions = await planBlockedImportantIssueDedupeDecisions({
      workspaceId,
      candidates,
    });

    expect(decisions).toEqual([
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
});
