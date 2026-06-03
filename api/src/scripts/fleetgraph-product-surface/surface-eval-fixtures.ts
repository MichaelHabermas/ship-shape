// FleetGraph product-surface fixtures collect persisted and runtime cases for copy evals.
import path from 'path';
import { pool } from '../../db/client.js';
import { fleetGraphProductSurfaceCases } from '../../fleetgraph/eval/product-surface.js';
import { runFleetGraph, type FleetGraphPersistencePort } from '../../fleetgraph/core.js';
import {
  blockedImportantIssueDedupeKey,
  type FleetGraphFinding,
  type FleetGraphRunRow,
  type RecordFleetGraphRunInput,
} from '../../fleetgraph/persistence.js';
import type { FleetGraphAttentionCandidate } from '../../fleetgraph/detection/detector.js';
import type { FleetGraphVisibleOutput } from '../../fleetgraph/types.js';
import type { FleetGraphProductSurfaceCase } from '../../fleetgraph/eval/product-surface.js';

export const repoRoot = path.resolve(process.cwd(), '..');
export const outputRoot = path.join(repoRoot, 'my-docs/evals/fleetgraph-product-surface');
export const runsRoot = path.join(outputRoot, 'runs');
export const reviewNotesPath = path.join(outputRoot, 'review-notes.md');

const workspaceId = '11111111-1111-4111-8111-111111111111';
const issueId = '22222222-2222-4222-8222-222222222222';
const sprintId = '33333333-3333-4333-8333-333333333333';
const findingId = '44444444-4444-4444-8444-444444444444';
const userId = '55555555-5555-4555-8555-555555555555';
const dedupeKey = blockedImportantIssueDedupeKey({ workspaceId, issueId, sprintId });

export async function currentSurfaceCases(): Promise<FleetGraphProductSurfaceCase[]> {
  return [
    ...fleetGraphProductSurfaceCases,
    ...await runtimeSurfaceCases(),
  ];
}

export async function persistedSurfaceCases(): Promise<FleetGraphProductSurfaceCase[]> {
  try {
    const result = await pool.query<{
      id: string;
      mode: string;
      decision: string;
      output_snapshot: unknown;
      created_at: Date;
    }>(
      `SELECT id, mode, decision, output_snapshot, created_at
         FROM fleetgraph_runs
        WHERE output_snapshot ? 'title'
          AND output_snapshot ? 'summary'
          AND (
            mode = 'on_demand'
            OR decision IN ('create_finding', 'update_finding')
          )
        ORDER BY created_at DESC
        LIMIT 20`
    );

    return result.rows.flatMap((row) => {
      const output = visibleOutputFromUnknown(row.output_snapshot);
      if (!output) return [];
      const testCase = caseFromVisibleOutput(
        `fg-surface-persisted-${row.decision}-${row.id.slice(0, 8)}`,
        `Persisted ${row.mode}/${row.decision} output from ${row.created_at.toISOString()}`,
        output
      );
      if (!testCase) return [];
      return [{
        ...testCase,
        notes: [
          'Loaded from fleetgraph_runs.output_snapshot.',
          'This is the report path that tracks real persisted FleetGraph outputs over time.',
        ],
      }];
    });
  } catch (error) {
    console.warn(`Skipping persisted FleetGraph outputs: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}

async function runtimeSurfaceCases(): Promise<FleetGraphProductSurfaceCase[]> {
  const clearBlocker = candidate({
    issueTitle: 'Runtime issue clear blocker',
    blockerText: 'Waiting on API credentials.',
    assigneeId: userId,
  });
  const missingBlocker = candidate({
    issueTitle: 'Runtime issue needs reason',
    blockerText: '',
    assigneeId: userId,
  });
  const existingFinding = finding({
    title: 'Runtime existing finding',
    summary: 'Waiting on review · Week 11',
    recommended_action: {
      label: 'Ask Audit Load User 029 to confirm owner and next step for Week 11.',
      text: 'Ask Audit Load User 029 to confirm owner and next step for Week 11.',
    },
    evidence_snapshot: [{
      kind: 'source_issue',
      sourceDocumentId: issueId,
      sourceType: 'issue',
      claim: 'Issue #110',
      visibility: 'internal',
      visibleFields: ['title', 'state'],
    }, {
      kind: 'source_sprint',
      sourceDocumentId: sprintId,
      sourceType: 'sprint',
      claim: 'Week 11',
      visibility: 'internal',
      visibleFields: ['title', 'sprint_number'],
    }, {
      kind: 'blocker',
      sourceDocumentId: issueId,
      sourceType: 'issue',
      claim: 'Latest blocker text',
      excerpt: 'Waiting on review.',
      visibility: 'internal',
      visibleFields: ['blockers_encountered'],
    }],
  });

  const clearResult = await runFleetGraph({
    workspaceId,
    mode: 'proactive',
    trigger: {
      type: 'detector_decision',
      detectorDecision: { decision: 'create_finding', candidate: clearBlocker, existingFindingId: null },
    },
  }, { persistence: persistencePort(findingFromCandidate(clearBlocker)) });
  const missingResult = await runFleetGraph({
    workspaceId,
    mode: 'proactive',
    trigger: {
      type: 'detector_decision',
      detectorDecision: { decision: 'create_finding', candidate: missingBlocker, existingFindingId: null },
    },
  }, { persistence: persistencePort(findingFromCandidate(missingBlocker)) });
  const explainResult = await runFleetGraph({
    workspaceId,
    mode: 'on_demand',
    trigger: { type: 'explain_finding', findingId },
  }, { persistence: persistencePort(existingFinding) });

  return [
    caseFromVisibleOutput('fg-surface-runtime-proactive-clear-blocker', 'Runtime proactive clear-blocker output from runFleetGraph', clearResult.visibleOutput),
    caseFromVisibleOutput('fg-surface-runtime-proactive-missing-blocker', 'Runtime proactive missing-blocker output from runFleetGraph', missingResult.visibleOutput),
    caseFromVisibleOutput('fg-surface-runtime-explain-existing-finding', 'Runtime explain output from runFleetGraph', explainResult.visibleOutput),
  ].filter((testCase): testCase is FleetGraphProductSurfaceCase => Boolean(testCase));
}

function visibleOutputFromUnknown(value: unknown): FleetGraphVisibleOutput | null {
  if (!isRecord(value)) return null;
  if (typeof value.title !== 'string' || typeof value.summary !== 'string') return null;
  return {
    title: value.title,
    summary: value.summary,
    recommendedAction: isRecord(value.recommendedAction) ? value.recommendedAction : undefined,
    proposedRecipient: isRecord(value.proposedRecipient) ? value.proposedRecipient : undefined,
    uncertaintyNotes: Array.isArray(value.uncertaintyNotes)
      ? value.uncertaintyNotes.filter((note): note is string => typeof note === 'string' && note.trim().length > 0)
      : undefined,
    evidence: Array.isArray(value.evidence)
      ? value.evidence.filter((item): item is FleetGraphVisibleOutput['evidence'][number] => isRecord(item) && typeof item.kind === 'string' && typeof item.claim === 'string')
      : [],
    humanGate: isRecord(value.humanGate) ? value.humanGate : {},
    noSafeOutput: value.noSafeOutput === true,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function caseFromVisibleOutput(
  id: string,
  title: string,
  output: FleetGraphVisibleOutput | undefined
): FleetGraphProductSurfaceCase | null {
  if (!output) return null;
  const recommendedAction = visibleAction(output);
  const blockerText = output.evidence.find((item) => item.kind === 'blocker' && item.excerpt?.trim())?.excerpt;
  return {
    id,
    title,
    input: {
      cardTitle: output.title,
      cardSummary: output.summary,
      blockerText: blockerText ?? '',
      owner: visibleOwner(output),
      context: output.evidence.find((item) => item.kind === 'source_sprint')?.claim ?? null,
      nextAction: recommendedAction,
      visibleCopy: [
        output.title,
        output.summary,
        ...(recommendedAction ? [recommendedAction] : []),
        ...(output.uncertaintyNotes ?? []),
      ],
    },
    expectedMinimum: {
      actionability: 3,
      groundedness: 3,
      specificity: 3,
      brevity: 3,
      repetitionBudget: 3,
      informationDensity: 3,
      cavemanCopy: 3,
      duplicateFactControl: 3,
      uncertaintyHonesty: 3,
      missingDataUsefulness: 3,
      uiProofSeparation: 4,
    },
    notes: [
      'Generated through runFleetGraph, not a hand-authored product-surface example.',
      'Failures here identify current runtime copy that needs product wording work.',
    ],
  };
}

function visibleAction(output: FleetGraphVisibleOutput): string | undefined {
  const action = output.recommendedAction;
  if (!action) return undefined;
  for (const key of ['text', 'summary', 'label']) {
    const value = action[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return undefined;
}

function visibleOwner(output: FleetGraphVisibleOutput): string | null {
  const recipient = output.proposedRecipient;
  const displayName = recipient?.displayName;
  const role = recipient?.role;
  if (typeof displayName === 'string' && displayName.trim()) return displayName;
  return typeof role === 'string' && role.trim() ? role : null;
}

function candidate(input: { issueTitle: string; blockerText: string; assigneeId: string | null }): FleetGraphAttentionCandidate {
  return {
    workspace_id: workspaceId,
    issue_id: issueId,
    issue_title: input.issueTitle,
    issue_ticket_number: 110,
    issue_state: 'blocked',
    issue_priority: 'medium',
    issue_assignee_id: input.assigneeId,
    issue_assignee_name: input.assigneeId ? 'Audit Load User 029' : null,
    sprint_id: sprintId,
    sprint_title: 'Week 11',
    sprint_number: 11,
    sprint_owner_id: null,
    sprint_owner_name: null,
    project_id: null,
    project_title: null,
    project_owner_id: null,
    project_owner_name: null,
    program_id: null,
    program_title: null,
    program_owner_id: null,
    program_owner_name: null,
    blocker_text: input.blockerText,
    blocker_iteration_id: input.blockerText ? '66666666-6666-4666-8666-666666666666' : null,
    blocker_iteration_created_at: input.blockerText ? new Date('2026-05-28T00:00:00Z') : null,
    dedupeKey,
  };
}

function findingFromCandidate(input: FleetGraphAttentionCandidate): FleetGraphFinding {
  return finding({
    title: input.issue_title,
    summary: input.blocker_text
      ? `${input.blocker_text.replace(/\.$/, '')} · Week ${input.sprint_number ?? input.sprint_title}`
      : `Reason missing · Week ${input.sprint_number ?? input.sprint_title}`,
    recommended_action: {
      label: input.blocker_text
        ? `Ask Audit Load User 029 to confirm owner and next step for Week ${input.sprint_number ?? input.sprint_title}.`
        : 'Ask Audit Load User 029 to add the blocker reason.',
      text: input.blocker_text
        ? `Ask Audit Load User 029 to confirm owner and next step for Week ${input.sprint_number ?? input.sprint_title}.`
        : 'Ask Audit Load User 029 to add the blocker reason.',
    },
    evidence_snapshot: [{
      kind: 'source_issue',
      sourceDocumentId: issueId,
      sourceType: 'issue',
      claim: 'Issue #110',
      visibility: 'internal',
      visibleFields: ['title', 'state'],
    }, {
      kind: 'source_sprint',
      sourceDocumentId: sprintId,
      sourceType: 'sprint',
      claim: 'Week 11',
      visibility: 'internal',
      visibleFields: ['title', 'sprint_number'],
    }, {
      kind: 'blocker',
      sourceDocumentId: issueId,
      sourceType: 'issue',
      claim: input.blocker_text ? 'Latest blocker text' : 'Blocker missing',
      excerpt: input.blocker_text || undefined,
      visibility: 'internal',
      visibleFields: ['blockers_encountered'],
    }],
  });
}

function finding(overrides: Partial<FleetGraphFinding> = {}): FleetGraphFinding {
  return {
    id: findingId,
    workspace_id: workspaceId,
    source_issue_id: issueId,
    source_sprint_id: sprintId,
    dedupe_key: dedupeKey,
    status: 'needs_confirmation',
    severity: 'medium',
    confidence: 0.84,
    title: 'Runtime finding',
    summary: 'Runtime finding is blocked.',
    evidence_snapshot: [],
    recommended_action: { label: 'Confirm the unblock path' },
    draft_content: {},
    proposed_recipient: { role: 'issue_assignee', userId, displayName: 'Audit Load User 029' },
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
    ...overrides,
  };
}

function run(decision: FleetGraphRunRow['decision']): FleetGraphRunRow {
  return {
    id: '77777777-7777-4777-8777-777777777777',
    workspace_id: workspaceId,
    finding_id: findingId,
    source_issue_id: issueId,
    source_sprint_id: sprintId,
    mode: 'proactive',
    trigger_reason: 'surface-eval',
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

function persistencePort(existingFinding: FleetGraphFinding): FleetGraphPersistencePort {
  return {
    saveFinding: async () => existingFinding,
    recordRun: async (input: RecordFleetGraphRunInput) => run(input.decision),
    getFinding: async () => existingFinding,
    listFindingsForSource: async () => [existingFinding],
    listAnchorRuns: async () => [],
    refineDraft: async () => existingFinding,
    dismissFinding: async () => ({ ...existingFinding, status: 'dismissed' }),
    resolveFinding: async () => ({ ...existingFinding, status: 'resolved' }),
    suppressFinding: async () => ({ ...existingFinding, status: 'suppressed' }),
  };
}
