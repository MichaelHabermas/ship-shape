// Verifies FleetGraph database guards preserve workspace/type boundaries without blocking Ship documents.
import { randomUUID } from 'crypto';
import { describe, expect, it } from 'vitest';
import { pool } from '../db/client.js';
import { requireFirstRow } from '../utils/query-rows.js';
import {
  blockedImportantIssueDedupeKey,
  dismissFleetGraphFinding,
  recordFleetGraphRun,
  refineFleetGraphDraft,
  resolveFleetGraphFinding,
  saveBlockedImportantIssueFinding,
} from './persistence.js';

type DocumentSnapshotRow = {
  id: string;
  workspace_id: string;
  document_type: string;
  title: string;
  properties: Record<string, unknown>;
  deleted_at: Date | null;
  updated_at: Date;
};

async function createWorkspace(name: string): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO workspaces (name) VALUES ($1) RETURNING id`,
    [name]
  );

  return requireFirstRow(result.rows).id;
}

async function createDocument(input: {
  workspaceId: string;
  type: 'issue' | 'sprint' | 'wiki';
  title: string;
}): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO documents (workspace_id, document_type, title)
     VALUES ($1, $2, $3)
     RETURNING id`,
    [input.workspaceId, input.type, input.title]
  );

  return requireFirstRow(result.rows).id;
}

async function createUser(): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO users (email, name)
     VALUES ($1, $2)
     RETURNING id`,
    [`fleetgraph-${randomUUID()}@example.com`, 'FleetGraph Tester']
  );

  return requireFirstRow(result.rows).id;
}

async function documentSnapshot(documentIds: string[]): Promise<DocumentSnapshotRow[]> {
  const result = await pool.query<DocumentSnapshotRow>(
    `SELECT id, workspace_id, document_type, title, properties, deleted_at, updated_at
       FROM documents
      WHERE id = ANY($1::uuid[])
      ORDER BY id`,
    [documentIds]
  );

  return result.rows;
}

describe('FleetGraph database guards', () => {
  it('rejects findings that reference documents outside their workspace', async () => {
    const workspaceId = await createWorkspace('FleetGraph workspace');
    const otherWorkspaceId = await createWorkspace('Other workspace');
    const issueId = await createDocument({ workspaceId, type: 'issue', title: 'Issue' });
    const otherSprintId = await createDocument({
      workspaceId: otherWorkspaceId,
      type: 'sprint',
      title: 'Other week',
    });

    await expect(saveBlockedImportantIssueFinding({
      workspaceId,
      sourceIssueId: issueId,
      sourceSprintId: otherSprintId,
      severity: 'high',
      confidence: 0.8,
      title: 'Blocked important work',
      summary: 'Cross-workspace evidence must be rejected.',
    })).rejects.toThrow(/workspace/);
  });

  it('rejects findings that reference non-issue or non-sprint documents', async () => {
    const workspaceId = await createWorkspace('FleetGraph type workspace');
    const wikiId = await createDocument({ workspaceId, type: 'wiki', title: 'Wiki' });
    const sprintId = await createDocument({ workspaceId, type: 'sprint', title: 'Week' });

    await expect(saveBlockedImportantIssueFinding({
      workspaceId,
      sourceIssueId: wikiId,
      sourceSprintId: sprintId,
      severity: 'high',
      confidence: 0.8,
      title: 'Blocked important work',
      summary: 'Wrong source document type must be rejected.',
    })).rejects.toThrow(/issue document/);
  });

  it('suppresses open findings when a Ship source document is soft deleted', async () => {
    const workspaceId = await createWorkspace('FleetGraph suppression workspace');
    const issueId = await createDocument({ workspaceId, type: 'issue', title: 'Issue' });
    const sprintId = await createDocument({ workspaceId, type: 'sprint', title: 'Week' });
    const finding = await saveBlockedImportantIssueFinding({
      workspaceId,
      sourceIssueId: issueId,
      sourceSprintId: sprintId,
      severity: 'high',
      confidence: 0.8,
      title: 'Blocked important work',
      summary: 'Issue has a blocker in the active week.',
    });

    await pool.query(`UPDATE documents SET deleted_at = NOW() WHERE id = $1`, [issueId]);

    const result = await pool.query<{
      status: string;
      run_metadata: { suppressed_reason?: string };
    }>(
      `SELECT status, run_metadata
         FROM fleetgraph_findings
        WHERE id = $1`,
      [finding.id]
    );

    expect(result.rows[0]?.status).toBe('suppressed');
    expect(result.rows[0]?.run_metadata.suppressed_reason).toBe('source_issue_invalidated');
  });

  it('derives the open finding dedupe key from workspace, issue, and sprint ids', async () => {
    const workspaceId = await createWorkspace('FleetGraph dedupe workspace');
    const issueId = await createDocument({ workspaceId, type: 'issue', title: 'Issue' });
    const sprintId = await createDocument({ workspaceId, type: 'sprint', title: 'Week' });

    const finding = await saveBlockedImportantIssueFinding({
      workspaceId,
      sourceIssueId: issueId,
      sourceSprintId: sprintId,
      severity: 'high',
      confidence: 0.8,
      title: 'Blocked important work',
      summary: 'Issue has a blocker in the active week.',
    });

    expect(finding.dedupe_key).toBe(blockedImportantIssueDedupeKey({
      workspaceId,
      issueId,
      sprintId,
    }));
  });

  it('upserts one active finding while allowing historical terminal findings with the same dedupe key', async () => {
    const workspaceId = await createWorkspace('FleetGraph upsert workspace');
    const issueId = await createDocument({ workspaceId, type: 'issue', title: 'Issue' });
    const sprintId = await createDocument({ workspaceId, type: 'sprint', title: 'Week' });
    const userId = await createUser();
    const dedupeKey = blockedImportantIssueDedupeKey({ workspaceId, issueId, sprintId });

    const first = await saveBlockedImportantIssueFinding({
      workspaceId,
      sourceIssueId: issueId,
      sourceSprintId: sprintId,
      severity: 'medium',
      confidence: 0.6,
      title: 'First title',
      summary: 'First summary.',
    });
    const second = await saveBlockedImportantIssueFinding({
      workspaceId,
      sourceIssueId: issueId,
      sourceSprintId: sprintId,
      severity: 'urgent',
      confidence: 0.9,
      title: 'Second title',
      summary: 'Second summary.',
    });

    expect(second.id).toBe(first.id);
    expect(second.title).toBe('Second title');

    await dismissFleetGraphFinding({ workspaceId, findingId: second.id, dismissedBy: userId });

    const reopened = await saveBlockedImportantIssueFinding({
      workspaceId,
      sourceIssueId: issueId,
      sourceSprintId: sprintId,
      severity: 'high',
      confidence: 0.7,
      title: 'Reopened title',
      summary: 'Reopened summary.',
    });

    const count = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
         FROM fleetgraph_findings
        WHERE dedupe_key = $1`,
      [dedupeKey]
    );

    expect(reopened.id).not.toBe(second.id);
    expect(count.rows[0]?.count).toBe('2');
  });

  it('keeps Ship documents unchanged when FleetGraph helpers mutate diagnosis state', async () => {
    const workspaceId = await createWorkspace('FleetGraph boundary workspace');
    const issueId = await createDocument({ workspaceId, type: 'issue', title: 'Issue' });
    const sprintId = await createDocument({ workspaceId, type: 'sprint', title: 'Week' });
    const userId = await createUser();
    const finding = await saveBlockedImportantIssueFinding({
      workspaceId,
      sourceIssueId: issueId,
      sourceSprintId: sprintId,
      severity: 'high',
      confidence: 0.8,
      title: 'Blocked important work',
      summary: 'Issue has a blocker in the active week.',
    });
    const before = await documentSnapshot([issueId, sprintId]);

    await refineFleetGraphDraft({
      workspaceId,
      findingId: finding.id,
      draftContent: { message: 'Can you confirm the blocker?' },
      humanGate: { required: true },
    });
    await recordFleetGraphRun({
      workspaceId,
      findingId: finding.id,
      sourceIssueId: issueId,
      sourceSprintId: sprintId,
      mode: 'on_demand',
      triggerReason: 'explain',
      decision: 'explain',
    });
    await resolveFleetGraphFinding({ workspaceId, findingId: finding.id });

    const resolved = await saveBlockedImportantIssueFinding({
      workspaceId,
      sourceIssueId: issueId,
      sourceSprintId: sprintId,
      severity: 'high',
      confidence: 0.8,
      title: 'Blocked important work again',
      summary: 'Issue still has a blocker in the active week.',
    });
    await dismissFleetGraphFinding({ workspaceId, findingId: resolved.id, dismissedBy: userId });

    expect(await documentSnapshot([issueId, sprintId])).toEqual(before);
  });

  it('rejects contradictory terminal finding states', async () => {
    const workspaceId = await createWorkspace('FleetGraph status workspace');
    const issueId = await createDocument({ workspaceId, type: 'issue', title: 'Issue' });
    const sprintId = await createDocument({ workspaceId, type: 'sprint', title: 'Week' });
    const dedupeKey = blockedImportantIssueDedupeKey({ workspaceId, issueId, sprintId });

    await expect(pool.query(
      `INSERT INTO fleetgraph_findings (
         workspace_id, source_issue_id, source_sprint_id, dedupe_key,
         status, severity, confidence, title, summary
       )
       VALUES ($1, $2, $3, $4, 'resolved', 'high', 0.8, 'Bad state', 'Bad state')`,
      [workspaceId, issueId, sprintId, dedupeKey]
    )).rejects.toThrow(/fleetgraph_findings_status_timestamps_check/);
  });
});
