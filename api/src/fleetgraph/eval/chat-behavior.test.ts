// Executes FleetGraph chat behavior golden cases through the shared graph with mocked persistence.
import { FLEETGRAPH_CHAT_HISTORY_LIMIT, type FleetGraphChatHistoryEntry } from '@ship/shared';
import { describe, expect, it, vi } from 'vitest';
import { pgResult } from '../../test/pg-result.js';
import { runFleetGraph, type FleetGraphPersistencePort } from '../core.js';
import {
  blockedImportantIssueDedupeKey,
  type FleetGraphFinding,
  type FleetGraphRun,
  type RecordFleetGraphRunInput,
} from '../persistence.js';
import type { Principal } from '../../security/principal.js';
import type { FleetGraphChatBehaviorFixture } from './chat-behavior.js';
import {
  evaluateFleetGraphChatBehaviorTurn,
  fleetGraphChatBehaviorCases,
} from './chat-behavior.js';

const workspaceId = '11111111-1111-4111-8111-111111111111';
const issueId = '22222222-2222-4222-8222-222222222222';
const sparseIssueId = '88888888-8888-4888-8888-888888888888';
const sprintId = '33333333-3333-4333-8333-333333333333';
const findingId = '44444444-4444-4444-8444-444444444444';
const userId = '55555555-5555-4555-8555-555555555555';
const dedupeKey = blockedImportantIssueDedupeKey({ workspaceId, issueId, sprintId });

const principal: Principal = {
  kind: 'session',
  sessionId: 'session-1',
  userId,
  workspaceId,
  isSuperAdmin: false,
};

function finding(): FleetGraphFinding {
  return {
    id: findingId,
    workspace_id: workspaceId,
    source_issue_id: issueId,
    source_sprint_id: sprintId,
    dedupe_key: dedupeKey,
    status: 'needs_confirmation',
    severity: 'urgent',
    confidence: 0.86,
    title: 'Blocked issue: Legacy reporting debt',
    summary: 'Legacy reporting debt is blocked by missing sample integration approval.',
    evidence_snapshot: [{
      kind: 'blocker',
      sourceDocumentId: issueId,
      sourceType: 'issue',
      claim: 'Latest iteration has blocker text.',
      excerpt: 'Waiting on sample integration approval for the Demo export.',
      visibility: 'internal',
      visibleFields: ['blockers_encountered'],
    }],
    recommended_action: { text: 'Ask Riley Reviewer to confirm the sample integration approval owner.' },
    draft_content: { message: 'Can you confirm who owns the sample integration approval?' },
    proposed_recipient: { displayName: 'Riley Reviewer', role: 'issue_assignee' },
    human_gate: { required: true },
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

function run(decision: FleetGraphRun['decision']): FleetGraphRun {
  return {
    id: '77777777-7777-4777-8777-777777777777',
    workspace_id: workspaceId,
    finding_id: findingId,
    source_issue_id: issueId,
    source_sprint_id: sprintId,
    mode: 'on_demand',
    trigger_reason: 'chat-behavior',
    decision,
    dedupe_key: dedupeKey,
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
  };
}

function persistence(fixture: FleetGraphChatBehaviorFixture): FleetGraphPersistencePort {
  const richFinding = finding();
  return {
    saveFinding: vi.fn(async () => richFinding),
    recordRun: vi.fn(async (input: RecordFleetGraphRunInput) => run(input.decision)),
    getFinding: vi.fn(async () => fixture === 'rich-ticket' ? richFinding : null),
    listFindingsForSource: vi.fn(async (input: Parameters<FleetGraphPersistencePort['listFindingsForSource']>[0]) => (
      fixture === 'rich-ticket' && input.sourceIssueId === issueId ? [richFinding] : []
    )),
    listAnchorRuns: vi.fn(async () => []),
    refineDraft: vi.fn(async () => richFinding),
    dismissFinding: vi.fn(async () => richFinding),
    resolveFinding: vi.fn(async () => richFinding),
    suppressFinding: vi.fn(async () => richFinding),
  };
}

function db() {
  return {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      if (sql.includes('workspace_memberships')) return pgResult([{ role: 'member' }]);
      if (sql.includes('document_associations')) return pgResult([{ type: 'sprint', title: 'Week 2' }]);
      if (sql.includes('FROM documents')) {
        const documentId = String(params?.[0] ?? '');
        if (documentId === issueId) {
          return pgResult([{
            id: issueId,
            title: 'Legacy reporting debt',
            document_type: 'issue',
            properties: { priority: 'urgent', state: 'in_progress' },
            content: docContent([
              'The current blocker is missing sample integration approval.',
              'Demo export is blocked by legacy reporting cleanup debt.',
              'Riley Reviewer owns the next step.',
            ]),
            yjs_state: null,
          }]);
        }
        if (documentId === sparseIssueId) {
          return pgResult([{
            id: sparseIssueId,
            title: 'Sparse onboarding task',
            document_type: 'issue',
            properties: { state: 'todo' },
            content: docContent(['Prepare onboarding checklist.']),
            yjs_state: null,
          }]);
        }
      }
      return pgResult([]);
    }),
  };
}

function docContent(lines: string[]) {
  return {
    type: 'doc',
    content: lines.map((text) => ({
      type: 'paragraph',
      content: [{ type: 'text', text }],
    })),
  };
}

function answerFromRun(input: RecordFleetGraphRunInput): string {
  const output = input.outputSnapshot as { answer?: { body?: unknown } } | undefined;
  return typeof output?.answer?.body === 'string' ? output.answer.body : '';
}

describe('FleetGraph chat behavior golden cases', () => {
  for (const testCase of fleetGraphChatBehaviorCases) {
    it(`${testCase.id}: ${testCase.title}`, async () => {
      const port = persistence(testCase.fixture);
      const history: FleetGraphChatHistoryEntry[] = [];
      let previousAnswer: string | undefined;

      for (let index = 0; index < testCase.turns.length; index++) {
        const turn = testCase.turns[index];
        const documentId = testCase.fixture === 'sparse-ticket' ? sparseIssueId : issueId;
        const result = await runFleetGraph({
          workspaceId,
          principal,
          mode: 'on_demand',
          trigger: {
            type: 'context_chat',
            prompt: turn.prompt,
            context: testCase.fixture === 'no-context'
              ? { kind: 'workspace' }
              : { kind: 'document', documentId, sourcePath: `/documents/${documentId}` },
            history: history.length > 0 ? history.slice(-FLEETGRAPH_CHAT_HISTORY_LIMIT) : undefined,
          },
          triggerReason: 'chat-behavior',
        }, { persistence: port, db: db() });

        const answer = answerFromRun(result.runInput);
        const failures = evaluateFleetGraphChatBehaviorTurn({
          caseId: testCase.id,
          turnIndex: index,
          answer,
          previousAnswer,
          expectation: turn.expect,
        });
        expect(failures).toEqual([]);

        history.push({ role: 'user', content: turn.prompt }, { role: 'assistant', content: answer });
        previousAnswer = answer;
      }
    });
  }
});
