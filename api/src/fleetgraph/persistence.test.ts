// Verifies FleetGraph persistence helpers write only FleetGraph-owned tables.
import { describe, expect, it, vi } from 'vitest';
import { pgResult } from '../test/pg-result.js';
import {
  blockedImportantIssueDedupeKey,
  dismissFleetGraphFinding,
  getOpenFleetGraphFindingByDedupeKey,
  recordFleetGraphRun,
  refineFleetGraphDraft,
  resolveFleetGraphFinding,
  saveBlockedImportantIssueFinding,
  type FleetGraphFindingStatus,
} from './persistence.js';

const workspaceId = '11111111-1111-4111-8111-111111111111';
const issueId = '22222222-2222-4222-8222-222222222222';
const sprintId = '33333333-3333-4333-8333-333333333333';
const findingId = '44444444-4444-4444-8444-444444444444';
const userId = '55555555-5555-4555-8555-555555555555';

function findingRow(overrides: Partial<{ status: FleetGraphFindingStatus }> = {}) {
  return {
    id: findingId,
    workspace_id: workspaceId,
    source_issue_id: issueId,
    source_sprint_id: sprintId,
    dedupe_key: blockedImportantIssueDedupeKey({ workspaceId, issueId, sprintId }),
    status: overrides.status ?? 'open',
    severity: 'high',
    confidence: '0.875',
    title: 'Blocked important work',
    summary: 'Issue has a blocker in the active week.',
    evidence_snapshot: [],
    recommended_action: {},
    draft_content: {},
    proposed_recipient: {},
    human_gate: {},
    trace_metadata: {},
    run_metadata: {},
    first_detected_at: new Date(),
    last_detected_at: new Date(),
    resolved_at: null,
    dismissed_at: null,
    dismissed_by: null,
    created_at: new Date(),
    updated_at: new Date(),
  };
}

function dbReturning(rows: unknown[]) {
  return {
    query: vi.fn().mockResolvedValue(pgResult(rows as never[])),
  };
}

describe('FleetGraph persistence', () => {
  it('builds the locked blocked-work dedupe key', () => {
    expect(blockedImportantIssueDedupeKey({ workspaceId, issueId, sprintId })).toBe(
      `blocked-important-issue:${workspaceId}:${issueId}:${sprintId}`
    );
  });

  it('reads open findings by dedupe key only from active FleetGraph statuses', async () => {
    const db = dbReturning([findingRow()]);

    const finding = await getOpenFleetGraphFindingByDedupeKey(workspaceId, 'dedupe-key', db);

    expect(finding?.confidence).toBe(0.875);
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining("status IN ('open', 'needs_confirmation', 'error')"),
      [workspaceId, 'dedupe-key']
    );
  });

  it('creates or updates an open finding through the partial dedupe key', async () => {
    const db = dbReturning([findingRow()]);
    const dedupeKey = blockedImportantIssueDedupeKey({ workspaceId, issueId, sprintId });

    const finding = await saveBlockedImportantIssueFinding({
      workspaceId,
      sourceIssueId: issueId,
      sourceSprintId: sprintId,
      severity: 'high',
      confidence: 0.875,
      title: 'Blocked important work',
      summary: 'Issue has a blocker in the active week.',
      evidenceSnapshot: [{ documentId: issueId, visible: true }],
      draftContent: { message: 'Can you confirm the blocker?' },
    }, db);

    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('ON CONFLICT (dedupe_key) WHERE status IN'),
      expect.arrayContaining([
        dedupeKey,
        JSON.stringify([{ documentId: issueId, visible: true }]),
      ])
    );
    expect(finding.status).toBe('open');
  });

  it('refines only FleetGraph-owned draft state and preserves the human gate', async () => {
    const db = dbReturning([findingRow({ status: 'needs_confirmation' })]);

    await refineFleetGraphDraft({
      workspaceId,
      findingId,
      draftContent: { message: 'Softer version' },
      humanGate: { required: true },
    }, db);

    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('draft_content = $3::jsonb'),
      [
        findingId,
        workspaceId,
        JSON.stringify({ message: 'Softer version' }),
        JSON.stringify({ required: true }),
        null,
      ]
    );
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining("status = 'needs_confirmation'"),
      expect.any(Array)
    );
  });

  it('dismisses and resolves findings without Ship mutations', async () => {
    const dismissDb = dbReturning([findingRow({ status: 'dismissed' })]);
    const resolveDb = dbReturning([findingRow({ status: 'resolved' })]);

    await dismissFleetGraphFinding({ workspaceId, findingId, dismissedBy: userId }, dismissDb);
    await resolveFleetGraphFinding({ workspaceId, findingId }, resolveDb);

    expect(dismissDb.query).toHaveBeenCalledWith(
      expect.stringContaining("status = 'dismissed'"),
      [findingId, workspaceId, userId]
    );
    expect(resolveDb.query).toHaveBeenCalledWith(
      expect.stringContaining("status = 'resolved'"),
      [findingId, workspaceId]
    );
  });

  it('records a run ledger entry with decision metadata', async () => {
    const db = dbReturning([{
      id: '66666666-6666-4666-8666-666666666666',
      workspace_id: workspaceId,
      finding_id: findingId,
      source_issue_id: issueId,
      source_sprint_id: sprintId,
      mode: 'proactive',
      trigger_reason: 'detector',
      decision: 'quiet_exit',
      dedupe_key: 'dedupe-key',
      input_snapshot: {},
      evidence_snapshot: [],
      output_snapshot: {},
      trace_metadata: {},
      token_metadata: {},
      cost_metadata: {},
      error_metadata: {},
      started_at: new Date(),
      completed_at: new Date(),
      created_at: new Date(),
    }]);

    await recordFleetGraphRun({
      workspaceId,
      findingId,
      sourceIssueId: issueId,
      sourceSprintId: sprintId,
      mode: 'proactive',
      triggerReason: 'detector',
      decision: 'quiet_exit',
      dedupeKey: 'dedupe-key',
      outputSnapshot: { reason: 'duplicate_open_finding' },
    }, db);

    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO fleetgraph_runs'),
      expect.arrayContaining([
        'quiet_exit',
        JSON.stringify({ reason: 'duplicate_open_finding' }),
      ])
    );
  });
});
