// Verifies FleetGraph deterministic detector SQL before any graph/model reasoning.
import { describe, expect, it, vi } from 'vitest';
import { pgResult } from '../test/pg-result.js';
import {
  findBlockedImportantIssueCandidates,
} from './detector.js';

const workspaceId = '11111111-1111-4111-8111-111111111111';
const issueId = '22222222-2222-4222-8222-222222222222';
const sprintId = '33333333-3333-4333-8333-333333333333';
const iterationId = '44444444-4444-4444-8444-444444444444';

function dbReturningCandidate() {
  return {
    query: vi.fn()
      .mockResolvedValueOnce(pgResult([{ sprint_start_date: '2026-05-18' }]))
      .mockResolvedValueOnce(pgResult([{
        workspace_id: workspaceId,
        issue_id: issueId,
        issue_title: 'Blocked issue',
        issue_ticket_number: 101,
        issue_state: 'in_progress',
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

    await findBlockedImportantIssueCandidates({
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

  it('selects only active-week urgent/high issues whose latest iteration has blocker text', async () => {
    const db = dbReturningCandidate();

    const candidates = await findBlockedImportantIssueCandidates({
      workspaceId,
      db,
      today: new Date('2026-05-26T12:00:00Z'),
    });
    const sql = db.query.mock.calls[1]?.[0] as string;

    expect(sql).toContain("i.document_type = 'issue'");
    expect(sql).toContain("i.properties->>'priority' IN ('urgent', 'high')");
    expect(sql).toContain("COALESCE(i.properties->>'state', 'backlog') NOT IN ('done', 'cancelled')");
    expect(sql).toContain("sprint_assoc.relationship_type = 'sprint'");
    expect(sql).toContain("(s.properties->>'sprint_number')::int = $2");
    expect(sql).toContain('JOIN LATERAL');
    expect(sql).toContain('ORDER BY iteration.created_at DESC, iteration.id DESC');
    expect(sql).toContain("btrim(COALESCE(latest_iteration.blockers_encountered, '')) <> ''");
    expect(sql).toContain("NULLIF(i.properties->>'assignee_id', '') IS NOT NULL");

    expect(candidates).toEqual([
      expect.objectContaining({
        issue_id: issueId,
        sprint_id: sprintId,
        dedupeKey: `blocked-important-issue:${workspaceId}:${issueId}:${sprintId}`,
      }),
    ]);
  });
});
