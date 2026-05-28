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
  startFleetGraphWorkerTick,
  heartbeatFleetGraphWorkerTick,
  completeFleetGraphWorkerTick,
  claimFleetGraphAttentionEvents,
  completeFleetGraphAttentionEvent,
  enqueueFleetGraphAttentionEvent,
  failFleetGraphAttentionEvent,
  markFleetGraphNotificationRead,
  markVisibleFleetGraphNotificationsRead,
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

  it('records worker tick lifecycle metadata', async () => {
    const tickId = '88888888-8888-4888-8888-888888888888';
    const deadlineAt = new Date('2026-05-26T12:04:00Z');
    const db = dbReturning([{
      id: tickId,
      instance_id: 'worker-1',
      status: 'running',
      started_at: new Date('2026-05-26T12:00:00Z'),
      heartbeat_at: new Date('2026-05-26T12:00:00Z'),
      deadline_at: deadlineAt,
      completed_at: null,
      workspace_count: 0,
      detector_decision_count: 0,
      result_count: 0,
      model_call_count: 0,
      error_metadata: {},
      audit_metadata: {},
      created_at: new Date('2026-05-26T12:00:00Z'),
    }]);

    await startFleetGraphWorkerTick({ instanceId: 'worker-1', deadlineAt }, db);
    await heartbeatFleetGraphWorkerTick(tickId, db);
    await completeFleetGraphWorkerTick({
      tickId,
      status: 'completed',
      workspaceCount: 2,
      detectorDecisionCount: 1,
      resultCount: 1,
      modelCallCount: 0,
      auditMetadata: { deadlineAt: deadlineAt.toISOString() },
    }, db);

    expect(db.query).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('INSERT INTO fleetgraph_worker_ticks'),
      ['worker-1', deadlineAt]
    );
    expect(db.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('heartbeat_at = NOW()'),
      [tickId]
    );
    expect(db.query).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining('detector_decision_count'),
      expect.arrayContaining([
        tickId,
        'completed',
        2,
        1,
        1,
        0,
        null,
        JSON.stringify({ deadlineAt: deadlineAt.toISOString() }),
      ])
    );
  });

  it('dedupes and claims durable attention events', async () => {
    const eventId = '99999999-9999-4999-8999-999999999999';
    const eventRow = {
      id: eventId,
      workspace_id: workspaceId,
      source_issue_id: issueId,
      source_sprint_id: sprintId,
      event_type: 'issue_changed',
      reason: 'issue_updated',
      status: 'pending',
      attempt_count: 0,
      last_error: null,
      available_at: new Date(),
      locked_at: null,
      locked_by: null,
      processed_at: null,
      created_at: new Date(),
      updated_at: new Date(),
    };
    const db = dbReturning([eventRow]);

    await enqueueFleetGraphAttentionEvent({
      workspaceId,
      sourceIssueId: issueId,
      sourceSprintId: sprintId,
      eventType: 'issue_changed',
      reason: 'issue_updated',
    }, db);
    await claimFleetGraphAttentionEvents({ lockedBy: 'worker-1', limit: 2 }, db);
    await completeFleetGraphAttentionEvent({ eventId, status: 'completed' }, db);

    expect(db.query).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('ON CONFLICT'),
      expect.arrayContaining([workspaceId, issueId, sprintId, 'issue_changed', 'issue_updated'])
    );
    expect(db.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("status = 'processing'"),
      [2, 'worker-1', null, 10, null]
    );
    expect(db.query.mock.calls[1]?.[0]).toContain("status = 'pending'");
    expect(db.query.mock.calls[1]?.[0]).toContain("status = 'processing'");
    expect(db.query.mock.calls[1]?.[0]).toContain('FOR UPDATE SKIP LOCKED');
    expect(db.query).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining("status = 'processing'"),
      [eventId, 'completed', null]
    );
  });

  it('can restrict durable attention event claims to explicit workspaces', async () => {
    const db = dbReturning([]);

    await claimFleetGraphAttentionEvents({
      lockedBy: 'worker-1',
      limit: 2,
      workspaceIds: [workspaceId],
    }, db);

    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('workspace_id = ANY($5::uuid[])'),
      [2, 'worker-1', null, 10, [workspaceId]]
    );
  });

  it('marks failed attention events pending for retry before terminal attempts', async () => {
    const eventId = '99999999-9999-4999-8999-999999999999';
    const retryAt = new Date('2026-05-26T12:00:30Z');
    const db = {
      query: vi.fn()
        .mockResolvedValueOnce(pgResult([{ attempt_count: 1 }]))
        .mockResolvedValueOnce(pgResult([{
          id: eventId,
          workspace_id: workspaceId,
          source_issue_id: issueId,
          source_sprint_id: sprintId,
          event_type: 'issue_changed',
          reason: 'issue_updated',
          status: 'pending',
          attempt_count: 1,
          last_error: 'temporary failure',
          available_at: retryAt,
          locked_at: null,
          locked_by: null,
          processed_at: null,
          created_at: retryAt,
          updated_at: retryAt,
        }])),
    };

    const event = await failFleetGraphAttentionEvent({
      eventId,
      lastError: 'temporary failure',
      maxAttempts: 3,
      now: new Date('2026-05-26T12:00:00Z'),
    }, db);

    expect(event?.status).toBe('pending');
    expect(db.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("WHEN $3::boolean THEN 'failed' ELSE 'pending'"),
      [eventId, 'temporary failure', false, retryAt]
    );
  });

  it('marks attention events terminal failed at max attempts', async () => {
    const eventId = '99999999-9999-4999-8999-999999999999';
    const now = new Date('2026-05-26T12:00:00Z');
    const db = {
      query: vi.fn()
        .mockResolvedValueOnce(pgResult([{ attempt_count: 3 }]))
        .mockResolvedValueOnce(pgResult([{
          id: eventId,
          workspace_id: workspaceId,
          source_issue_id: issueId,
          source_sprint_id: sprintId,
          event_type: 'issue_changed',
          reason: 'issue_updated',
          status: 'failed',
          attempt_count: 3,
          last_error: 'terminal failure',
          available_at: now,
          locked_at: null,
          locked_by: null,
          processed_at: now,
          created_at: now,
          updated_at: now,
        }])),
    };

    const event = await failFleetGraphAttentionEvent({
      eventId,
      lastError: 'terminal failure',
      maxAttempts: 3,
      now,
    }, db);

    expect(event?.status).toBe('failed');
    expect(db.query).toHaveBeenNthCalledWith(
      2,
      expect.any(String),
      [eventId, 'terminal failure', true, null]
    );
  });

  it('marks notification read state without mutating findings', async () => {
    const db = dbReturning([{ finding_id: findingId }]);

    await markFleetGraphNotificationRead({ workspaceId, findingId, userId }, db);
    await markVisibleFleetGraphNotificationsRead({ workspaceId, userId, findingIds: [findingId] }, db);

    expect(db.query).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('fleetgraph_notification_reads'),
      [workspaceId, findingId, userId]
    );
    expect(db.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('fleetgraph_findings'),
      [workspaceId, userId, [findingId]]
    );
  });
});
