// Verifies FleetGraph deterministic detector SQL before any graph/model reasoning.
import { describe, expect, it, vi } from 'vitest';
import { pgResult } from '../test/pg-result.js';
import {
  detectBlockedImportantIssueDecisions,
  findBlockedImportantIssueQuietExits,
  recordBlockedImportantIssueQuietExitRun,
} from './detector.js';
import { blockedImportantIssueDedupeKey } from './persistence.js';

const workspaceId = '11111111-1111-4111-8111-111111111111';
const issueId = '22222222-2222-4222-8222-222222222222';
const sprintId = '33333333-3333-4333-8333-333333333333';
const iterationId = '44444444-4444-4444-8444-444444444444';
const existingFindingId = '77777777-7777-4777-8777-777777777777';
const dedupeKey = blockedImportantIssueDedupeKey({ workspaceId, issueId, sprintId });

function dbReturningCandidate() {
  return {
    query: vi.fn()
      .mockResolvedValueOnce(pgResult([{ sprint_start_date: '2026-05-18' }]))
      .mockResolvedValueOnce(pgResult([{
        workspace_id: workspaceId,
        issue_id: issueId,
        issue_title: 'Blocked issue',
        issue_ticket_number: 101,
        issue_state: 'blocked',
        issue_priority: 'urgent',
        issue_assignee_id: '55555555-5555-4555-8555-555555555555',
        sprint_id: sprintId,
        sprint_title: 'Week 2',
        sprint_number: 2,
        sprint_owner_id: null,
        blocker_text: 'Waiting on API credentials.',
        blocker_iteration_id: iterationId,
        blocker_iteration_created_at: new Date('2026-05-26T12:00:00Z'),
      }])),
  };
}

describe('FleetGraph detector', () => {
  it('uses the shared current-week boundary before selecting candidates', async () => {
    const db = dbReturningCandidate();
    db.query.mockResolvedValueOnce(pgResult([]));

    await detectBlockedImportantIssueDecisions({
      workspaceId,
      db,
      today: new Date('2026-05-26T12:00:00Z'),
    });

    expect(db.query).toHaveBeenNthCalledWith(
      1,
      'SELECT sprint_start_date FROM workspaces WHERE id = $1',
      [workspaceId]
    );
    expect(db.query).toHaveBeenNthCalledWith(
      2,
      expect.any(String),
      [workspaceId, 2, 25]
    );
  });

  it('selects active-week urgent/high blocked issues with blocker evidence', async () => {
    const db = dbReturningCandidate();
    db.query.mockResolvedValueOnce(pgResult([]));

    const decisions = await detectBlockedImportantIssueDecisions({
      workspaceId,
      db,
      today: new Date('2026-05-26T12:00:00Z'),
    });
    const sql = db.query.mock.calls[1]?.[0] as string;

    expect(sql).toContain("i.document_type = 'issue'");
    expect(sql).toContain("i.properties->>'priority' IN ('urgent', 'high')");
    expect(sql).toContain("COALESCE(i.properties->>'state', 'backlog') = 'blocked'");
    expect(sql).toContain("sprint_assoc.relationship_type = 'sprint'");
    expect(sql).toContain("s.properties->>'sprint_number' ~ '^\\d+$'");
    expect(sql).toContain('JOIN LATERAL');
    expect(sql).toContain('ORDER BY iteration.created_at DESC, iteration.id DESC');
    expect(sql).toContain("btrim(COALESCE(iteration.blockers_encountered, '')) <> ''");
    expect(sql).toContain("NULLIF(i.properties->>'assignee_id', '') IS NOT NULL");

    expect(decisions[0]?.candidate).toEqual(expect.objectContaining({
      issue_id: issueId,
      sprint_id: sprintId,
      dedupeKey,
    }));
  });

  it('classifies quiet exits deterministically', async () => {
    const db = {
      query: vi.fn()
        .mockResolvedValueOnce(pgResult([{ sprint_start_date: '2026-05-18' }]))
        .mockResolvedValueOnce(pgResult([
          { reason: 'inactive_week', count: '1' },
          { reason: 'no_blocker', count: '2' },
          { reason: 'medium_low_priority', count: '3' },
          { reason: 'done_or_cancelled', count: '4' },
          { reason: 'missing_fallback_owner', count: '5' },
          { reason: 'duplicate_open_finding', count: '6' },
          { reason: 'insufficient_visible_evidence', count: '0' },
        ])),
    };

    const quietExits = await findBlockedImportantIssueQuietExits({
      workspaceId,
      db,
      today: new Date('2026-05-26T12:00:00Z'),
    });
    const sql = db.query.mock.calls[1]?.[0] as string;

    expect(db.query).toHaveBeenCalledTimes(2);
    expect(sql).toContain('issue_week_context AS');
    expect(sql).toContain('classified AS');
    expect(sql).toContain('inactive_week');
    expect(sql).toContain('no_blocker');
    expect(sql).toContain('medium_low_priority');
    expect(sql).toContain('done_or_cancelled');
    expect(sql).toContain('missing_fallback_owner');
    expect(sql).toContain('duplicate_open_finding');
    expect(sql).toContain('insufficient_visible_evidence');
    expect(sql).toContain('LEFT JOIN fleetgraph_findings');
    expect(sql).toContain(`'blocked-important-issue', ':', i.workspace_id, ':', i.id, ':', s.id`);
    expect(quietExits).toEqual([
      { reason: 'done_or_cancelled', count: 4 },
      { reason: 'duplicate_open_finding', count: 6 },
      { reason: 'inactive_week', count: 1 },
      { reason: 'insufficient_visible_evidence', count: 0 },
      { reason: 'medium_low_priority', count: 3 },
      { reason: 'missing_fallback_owner', count: 5 },
      { reason: 'no_blocker', count: 2 },
    ]);
  });

  it('plans create and update dedupe decisions from open findings', async () => {
    const db = dbReturningCandidate();
    db.query.mockResolvedValueOnce(pgResult([{
      id: existingFindingId,
      dedupe_key: dedupeKey,
    }]));

    const decisions = await detectBlockedImportantIssueDecisions({
      workspaceId,
      db,
      today: new Date('2026-05-26T12:00:00Z'),
      limit: 10,
    });

    expect(db.query).toHaveBeenCalledWith(expect.any(String), [workspaceId, 2, 10]);
    expect(db.query).toHaveBeenLastCalledWith(
      expect.stringContaining("status IN ('open', 'needs_confirmation', 'error')"),
      [workspaceId, [dedupeKey]]
    );
    expect(decisions).toHaveLength(1);
    expect(decisions[0]?.decision).toBe('update_finding');
    expect(decisions[0]?.candidate.issue_id).toBe(issueId);
    expect(decisions[0]?.existingFindingId).toBe(existingFindingId);

    const createDb = dbReturningCandidate();
    createDb.query.mockResolvedValueOnce(pgResult([]));

    const createDecisions = await detectBlockedImportantIssueDecisions({
      workspaceId,
      db: createDb,
      today: new Date('2026-05-26T12:00:00Z'),
    });
    expect(createDecisions).toHaveLength(1);
    expect(createDecisions[0]?.decision).toBe('create_finding');
    expect(createDecisions[0]?.candidate.issue_id).toBe(issueId);
    expect(createDecisions[0]?.existingFindingId).toBeNull();
  });

  it('dedupes repeated candidate rows before returning decisions', async () => {
    const candidateRow = {
      workspace_id: workspaceId,
      issue_id: issueId,
      issue_title: 'Blocked issue',
      issue_ticket_number: 101,
      issue_state: 'blocked',
      issue_priority: 'urgent',
      issue_assignee_id: '55555555-5555-4555-8555-555555555555',
      sprint_id: sprintId,
      sprint_title: 'Week 2',
      sprint_number: 2,
      sprint_owner_id: null,
      blocker_text: 'Waiting on API credentials.',
      blocker_iteration_id: iterationId,
      blocker_iteration_created_at: new Date('2026-05-26T12:00:00Z'),
    };
    const db = {
      query: vi.fn()
        .mockResolvedValueOnce(pgResult([{ sprint_start_date: '2026-05-18' }]))
        .mockResolvedValueOnce(pgResult([candidateRow, candidateRow]))
        .mockResolvedValueOnce(pgResult([])),
    };

    const decisions = await detectBlockedImportantIssueDecisions({
      workspaceId,
      db,
      today: new Date('2026-05-26T12:00:00Z'),
    });

    expect(decisions).toHaveLength(1);
    expect(decisions[0]?.decision).toBe('create_finding');
    expect(decisions[0]?.candidate.dedupeKey).toBe(dedupeKey);
    expect(decisions[0]?.existingFindingId).toBeNull();
  });

  it('does not query open findings when there are no candidates to dedupe', async () => {
    const db = {
      query: vi.fn()
        .mockResolvedValueOnce(pgResult([{ sprint_start_date: '2026-05-18' }]))
        .mockResolvedValueOnce(pgResult([])),
    };

    await expect(detectBlockedImportantIssueDecisions({
      workspaceId,
      db,
      today: new Date('2026-05-26T12:00:00Z'),
    })).resolves.toEqual([]);

    expect(db.query).toHaveBeenCalledTimes(2);
  });

  it.each([
    {
      label: 'nonzero quiet exits',
      quietExits: [
        { reason: 'no_blocker' as const, count: 2 },
        { reason: 'insufficient_visible_evidence' as const, count: 0 },
      ],
    },
    {
      label: 'all-zero quiet exits',
      quietExits: [{ reason: 'insufficient_visible_evidence' as const, count: 0 }],
    },
  ])('records $label without model calls', async ({ quietExits }) => {
    const db = {
      query: vi.fn().mockResolvedValue(pgResult([{
        id: '66666666-6666-4666-8666-666666666666',
        workspace_id: workspaceId,
        finding_id: null,
        source_issue_id: null,
        source_sprint_id: null,
        mode: 'proactive',
        trigger_reason: 'blocked-important-issue-detector',
        decision: 'quiet_exit',
        dedupe_key: null,
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
      }])),
    };

    await recordBlockedImportantIssueQuietExitRun({
      workspaceId,
      quietExits,
      db,
    });

    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO fleetgraph_runs'),
      expect.arrayContaining([
        workspaceId,
        'proactive',
        'blocked-important-issue-detector',
        'quiet_exit',
        JSON.stringify({ quietExits }),
        JSON.stringify({ modelCalls: 0 }),
        JSON.stringify({ modelCostUsd: 0 }),
      ])
    );
  });
});
