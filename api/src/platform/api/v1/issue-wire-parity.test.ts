// Issue wire parity tests keep public API and webhook payloads aligned on issue-core fields.
import { describe, expect, it } from 'vitest';
import {
  issueCoreFromDocumentRow,
  webhookIssueResourceFromCore,
} from '../../../services/issue-mutations/issue-core.js';
import { publicIssueFromRow, type PublicIssueRow } from './issue-read-model.js';

describe('issue wire parity', () => {
  it('maps the same row to matching core fields in public and webhook shapes', () => {
    const row: PublicIssueRow = {
      id: '11111111-1111-4111-8111-111111111111',
      title: 'Parity issue',
      properties: {
        state: 'in_progress',
        priority: 'high',
        source: 'internal',
        assignee_id: '22222222-2222-4222-8222-222222222222',
      },
      ticket_number: 42,
      created_at: new Date('2026-01-01T00:00:00.000Z'),
      updated_at: new Date('2026-01-02T00:00:00.000Z'),
      created_by: '33333333-3333-4333-8333-333333333333',
      started_at: null,
      completed_at: null,
      cancelled_at: null,
      reopened_at: null,
      converted_from_id: null,
      assignee_name: 'Assignee',
      assignee_archived: false,
    };

    const core = issueCoreFromDocumentRow(row);
    const webhook = webhookIssueResourceFromCore(core);
    const issue = publicIssueFromRow(row, { includeContent: false, belongsTo: [] });

    expect(issue.id).toBe(webhook.id);
    expect(issue.title).toBe(webhook.title);
    expect(issue.display_id).toBe(webhook.display_id);
    expect(issue.ticket_number).toBe(webhook.ticket_number);
    expect(issue.state).toBe(webhook.state);
    expect(issue.assignee_id).toBe(webhook.assignee_id);
  });
});
