// Verifies FleetGraph attention event helpers fan out source-change rechecks safely.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { pgResult } from '../test/pg-result.js';
import {
  enqueueFleetGraphIssueAttentionEvents,
  listIssueSprintIdsForFleetGraphEvent,
} from './events.js';
import { enqueueFleetGraphAttentionEvent } from './persistence.js';

vi.mock('./persistence.js', () => ({
  enqueueFleetGraphAttentionEvent: vi.fn(),
}));

const workspaceId = '11111111-1111-4111-8111-111111111111';
const issueId = '22222222-2222-4222-8222-222222222222';
const sprintId = '33333333-3333-4333-8333-333333333333';

describe('FleetGraph attention events', () => {
  beforeEach(() => {
    vi.mocked(enqueueFleetGraphAttentionEvent).mockReset();
  });

  it('lists active sprint associations for an issue in the same workspace', async () => {
    const db = {
      query: vi.fn().mockResolvedValue(pgResult([{ sprint_id: sprintId }])),
    };

    await expect(listIssueSprintIdsForFleetGraphEvent({
      workspaceId,
      issueId,
      db,
    })).resolves.toEqual([sprintId]);

    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining("relationship_type = 'sprint'"),
      [issueId, workspaceId]
    );
    expect(db.query.mock.calls[0]?.[0]).toContain("sprint.document_type = 'sprint'");
    expect(db.query.mock.calls[0]?.[0]).toContain('sprint.archived_at IS NULL');
  });

  it('dedupes issue ids and enqueues one event per sprint association', async () => {
    const db = {
      query: vi.fn().mockResolvedValue(pgResult([{ sprint_id: sprintId }])),
    };

    await enqueueFleetGraphIssueAttentionEvents({
      workspaceId,
      issueIds: [issueId, issueId, ''],
      eventType: 'issue_changed',
      reason: 'issue_updated',
      db,
    });

    expect(db.query).toHaveBeenCalledTimes(1);
    expect(enqueueFleetGraphAttentionEvent).toHaveBeenCalledWith({
      workspaceId,
      sourceIssueId: issueId,
      sourceSprintId: sprintId,
      eventType: 'issue_changed',
      reason: 'issue_updated',
    }, db);
  });

  it('enqueues a null-sprint event when the issue has no sprint association', async () => {
    const db = {
      query: vi.fn().mockResolvedValue(pgResult([])),
    };

    await enqueueFleetGraphIssueAttentionEvents({
      workspaceId,
      issueIds: [issueId],
      eventType: 'issue_changed',
      reason: 'issue_updated',
      db,
    });

    expect(enqueueFleetGraphAttentionEvent).toHaveBeenCalledWith({
      workspaceId,
      sourceIssueId: issueId,
      sourceSprintId: null,
      eventType: 'issue_changed',
      reason: 'issue_updated',
    }, db);
  });

  it('logs enqueue failures without blocking later issue events', async () => {
    const nextIssueId = '44444444-4444-4444-8444-444444444444';
    const db = {
      query: vi.fn()
        .mockRejectedValueOnce(new Error('db unavailable'))
        .mockResolvedValueOnce(pgResult([])),
    };
    const logger = { warn: vi.fn() };

    await enqueueFleetGraphIssueAttentionEvents({
      workspaceId,
      issueIds: [issueId, nextIssueId],
      eventType: 'issue_changed',
      reason: 'issue_updated',
      db,
      logger,
    });

    expect(logger.warn).toHaveBeenCalledWith(
      '[FleetGraph] Failed to enqueue attention event',
      expect.objectContaining({
        workspaceId,
        issueId,
        eventType: 'issue_changed',
        message: 'db unavailable',
      })
    );
    expect(enqueueFleetGraphAttentionEvent).toHaveBeenCalledWith(
      expect.objectContaining({ sourceIssueId: nextIssueId, sourceSprintId: null }),
      db
    );
  });
});
