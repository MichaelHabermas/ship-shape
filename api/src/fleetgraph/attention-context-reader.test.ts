// Unit tests for in-process and HTTP attention-context reader adapters.
import { describe, expect, it, vi } from 'vitest';
import type { PublicFleetGraphAttentionContext } from '@ship/shared';
import {
  HttpAttentionContextReader,
  InProcessAttentionContextReader,
} from './attention-context-reader.js';

describe('AttentionContextReader adapters', () => {
  it('returns HTTP list results from the SDK client', async () => {
    const row = {
      workspace_id: '11111111-1111-4111-8111-111111111111',
      issue_id: '22222222-2222-4222-8222-222222222222',
      issue_title: 'HTTP issue',
      issue_ticket_number: 1,
      issue_state: 'todo',
      issue_priority: 'medium',
      issue_assignee_id: null,
      issue_assignee_name: null,
      issue_visibility: 'workspace',
      issue_created_at: '2026-01-01T00:00:00.000Z',
      issue_updated_at: '2026-01-01T00:00:00.000Z',
      meaningful_updated_at: '2026-01-01T00:00:00.000Z',
    } as PublicFleetGraphAttentionContext;
    const sample = { data: [row] };
    const list = vi.fn(async () => sample);
    const reader = new HttpAttentionContextReader({
      fleetgraph: {
        attentionContexts: { list },
      },
    } as never);

    const first = sample.data[0];
    if (!first) throw new Error('expected sample attention context row');
    const data = await reader.listAttentionContexts({
      workspaceId: first.workspace_id,
      viewerUserId: '33333333-3333-4333-8333-333333333333',
      sourceIssueId: first.issue_id,
      limit: 1,
    });

    expect(list).toHaveBeenCalledWith({
      limit: 1,
      source_issue_id: first.issue_id,
    });
    expect(data).toEqual(sample.data);
  });

  it('exposes in-process reader as AttentionContextReader', () => {
    expect(new InProcessAttentionContextReader()).toHaveProperty('listAttentionContexts');
  });
});
