// FleetGraph reviewer proof assembles live causal chains from durable Ship and FleetGraph ledgers.
import { execFile } from 'child_process';
import { readFile, stat } from 'fs/promises';
import path from 'path';
import { promisify } from 'util';
import type {
  FleetGraphReviewerChain,
  FleetGraphReviewerChainsResponse,
  FleetGraphReviewerProofResponse,
  FleetGraphReviewerProofVerdict,
  FleetGraphReviewerRepairResponse,
  FleetGraphReviewerScenarioResponse,
  FleetGraphReviewerStep,
  FleetGraphReviewerStepStatus,
  FleetGraphReviewerTraceScore,
  FleetGraphUsage,
} from '@ship/shared';
import { pool } from '../db/client.js';
import type { Principal } from '../security/principal.js';
import { addBelongsToAssociation } from '../utils/document-crud.js';
import { resolveFleetGraphCurrentWeek } from './detection/current-week.js';
import { enqueueFleetGraphAttentionEvent } from './persistence.js';
import { visibleOutputForFinding } from './evidence.js';
import { traceMetadataForResponse } from './trace.js';
import {
  fleetGraphNotificationResponse,
  serializeFleetGraphVisibleOutput,
} from './api-contract.js';
import {
  runFleetGraphWorkerTick,
} from './execution/worker.js';
import { runFleetGraph } from './core.js';
import type {
  FleetGraphFinding,
  FleetGraphNotificationFinding,
  FleetGraphRunDecision,
  JsonRecord,
} from './persistence.js';

type QueryRunner = Pick<typeof pool, 'query'>;

type ChainRow = {
  run_id: string;
  run_created_at: Date;
  run_started_at: Date;
  run_completed_at: Date | null;
  run_mode: 'proactive' | 'on_demand';
  trigger_reason: string;
  decision: FleetGraphRunDecision;
  dedupe_key: string | null;
  run_trace_metadata: JsonRecord;
  token_metadata: JsonRecord;
  cost_metadata: JsonRecord;
  source_issue_id: string | null;
  source_sprint_id: string | null;
  finding_id: string | null;
  finding_status: string | null;
  finding_first_detected_at: Date | null;
  finding_last_detected_at: Date | null;
  finding_trace_metadata: JsonRecord | null;
  issue_title: string | null;
  issue_state: string | null;
  issue_priority: string | null;
  issue_assignee_id: string | null;
  issue_updated_at: Date | null;
  sprint_title: string | null;
  attention_event_id: string | null;
  attention_event_status: string | null;
  attention_event_created_at: Date | null;
  attention_event_locked_at: Date | null;
  attention_event_processed_at: Date | null;
  worker_tick_id: string | null;
  worker_tick_status: string | null;
  worker_tick_started_at: Date | null;
  worker_tick_completed_at: Date | null;
  mutation_before_state: JsonRecord | null;
  mutation_after_state: JsonRecord | null;
  mutation_changed_fields: string[] | null;
  mutation_proof_created_at: Date | null;
};

type IssueRow = {
  id: string;
  properties: JsonRecord;
  updated_at: Date;
};

type ScenarioDocuments = {
  sourceIssueId: string;
  sourceSprintId: string;
};

type ReviewerSourceSnapshot = {
  sourceIssueId: string | null;
  findingId: string | null;
  state: JsonRecord;
};

const execFileAsync = promisify(execFile);
const REVIEWER_TITLE_PREFIX = '[FleetGraph Reviewer]';
const REVIEWER_WEEK_TITLE = `${REVIEWER_TITLE_PREFIX} Live Week`;
const LEGACY_REVIEWER_ISSUE_TITLE = `${REVIEWER_TITLE_PREFIX} Blocked credential path`;
const REVIEWER_ISSUE_TITLE = `${REVIEWER_TITLE_PREFIX} Human unblock path`;
export const REVIEWER_PROOF_BLOCKER_TEXT = 'Waiting on reviewer proof unblock decision';
const REQUIRED_STEP_KEYS = new Set([
  'source',
  'attention_event',
  'worker_tick',
  'graph_run',
  'trace',
  'finding',
  'notification_projection',
  'chat_human_gate',
]);
const LIVE_WORKER_FRESH_MS = 10 * 60 * 1000;
const TRACE_FRESH_MS = 24 * 60 * 60 * 1000;
const LATENCY_GOAL_MS = 5 * 60 * 1000;
export const CAUSAL_TIMESTAMP_SKEW_MS = 1000;
const PROOF_OUTPUT_TAIL_LINES = 12;
const PROOF_COMMAND_ENV_ALLOWLIST = new Set([
  'PATH',
  'HOME',
  'USER',
  'LOGNAME',
  'SHELL',
  'TMPDIR',
  'NODE_ENV',
  'PNPM_HOME',
  'COREPACK_HOME',
  'FLEETGRAPH_PROOF_TEST_DATABASE_URL',
  'FLEETGRAPH_PROOF_TRACE_URLS_JSON',
]);

type ReviewerProofArtifact = {
  verdict?: FleetGraphReviewerProofVerdict;
  reviewerChain?: { chainId?: unknown };
};

export class ReviewerProofCommandError extends Error {
  readonly command = 'pnpm fleetgraph:proof -- --mode local --no-refresh-evals --skip-tests';
  readonly outputTail: string[];

  constructor(message: string, outputTail: string[]) {
    super(message);
    this.name = 'ReviewerProofCommandError';
    this.outputTail = outputTail;
  }
}

export function fleetGraphReviewerProofEnabled(): boolean {
  return process.env.FLEETGRAPH_REVIEWER_PROOF_ENABLED === '1';
}

export async function listFleetGraphReviewerChains(input: {
  workspaceId: string;
  principal: Principal;
  limit?: number;
  db?: QueryRunner;
}): Promise<FleetGraphReviewerChainsResponse> {
  const chains = await loadReviewerChains({
    workspaceId: input.workspaceId,
    principal: input.principal,
    limit: input.limit ?? 25,
    db: input.db,
  });
  return {
    summary: reviewerSummary(chains),
    chains,
  };
}

export async function getFleetGraphReviewerChain(input: {
  workspaceId: string;
  principal: Principal;
  chainId: string;
  db?: QueryRunner;
}): Promise<FleetGraphReviewerChain | null> {
  const chains = await loadReviewerChainsById({
    workspaceId: input.workspaceId,
    principal: input.principal,
    chainId: input.chainId,
    db: input.db,
  });
  return chains[0] ?? null;
}

export async function runFleetGraphReviewerWeekBlockerScenario(input: {
  workspaceId: string;
  userId: string;
  principal: Principal;
  triggerWorker?: boolean;
  freshRun?: boolean;
  db?: QueryRunner;
}): Promise<FleetGraphReviewerScenarioResponse> {
  const db = input.db ?? pool;
  const docs = await ensureWeekBlockerScenarioDocuments({
    workspaceId: input.workspaceId,
    userId: input.userId,
    issueTitle: input.freshRun ? freshReviewerIssueTitle() : REVIEWER_ISSUE_TITLE,
    db,
  });
  const event = await enqueueFleetGraphAttentionEvent({
    workspaceId: input.workspaceId,
    sourceIssueId: docs.sourceIssueId,
    sourceSprintId: docs.sourceSprintId,
    eventType: 'issue_changed',
    reason: 'reviewer-week-blocker-scenario',
  }, db);

  if (input.triggerWorker !== false) {
    await runFleetGraphWorkerTick({
      workspaceIds: [input.workspaceId],
      instanceId: `fleetgraph-reviewer-${Date.now()}`,
      graphOptions: { forceReviewerTrace: true },
    });
  }

  const initialChain = (await loadReviewerChains({
    workspaceId: input.workspaceId,
    principal: input.principal,
    limit: 25,
    sourceIssueId: docs.sourceIssueId,
    db,
  }))[0] ?? placeholderScenarioChain({
    sourceIssueId: docs.sourceIssueId,
    sourceSprintId: docs.sourceSprintId,
    attentionEventId: event?.id,
  });
  const chain = initialChain.links.findingId
    ? await ensureReviewerSourceMutationProofAndReload({
        workspaceId: input.workspaceId,
        principal: input.principal,
        chain: initialChain,
        db,
      })
    : initialChain;

  return {
    chainId: chain.chainId,
    sourceIssueId: docs.sourceIssueId,
    sourceSprintId: docs.sourceSprintId,
    attentionEventId: event?.id,
    workerTickTriggered: input.triggerWorker !== false,
    chain,
  };
}

export async function runFleetGraphReviewerWorkerTick(input: {
  workspaceId: string;
}): Promise<{ triggered: true }> {
  await runFleetGraphWorkerTick({
    workspaceIds: [input.workspaceId],
    instanceId: `fleetgraph-reviewer-${Date.now()}`,
    graphOptions: { forceReviewerTrace: true },
  });
  return { triggered: true };
}

export async function repairFleetGraphReviewerProof(input: {
  workspaceId: string;
  principal: Principal;
  chainId: string;
  db?: QueryRunner;
}): Promise<FleetGraphReviewerRepairResponse> {
  const db = input.db ?? pool;
  const chain = await getFleetGraphReviewerChain({
    workspaceId: input.workspaceId,
    principal: input.principal,
    chainId: input.chainId,
    db,
  });
  if (!chain) {
    throw new Error('FleetGraph reviewer chain not found');
  }

  const repaired: string[] = [];
  const unsupported = chain.missing.filter((key) => key !== 'source_mutation_check');
  let refreshed = chain;
  if (chain.missing.includes('source_mutation_check')) {
    refreshed = await ensureReviewerSourceMutationProofAndReload({
      workspaceId: input.workspaceId,
      principal: input.principal,
      chain,
      db,
    });
    if (refreshed.sourceMutationCheck.passed) repaired.push('source_mutation_check');
  }

  return {
    chainId: refreshed.chainId,
    repaired,
    unsupported,
    chain: refreshed,
  };
}

export async function sourceSnapshotForReviewerChat(input: {
  workspaceId: string;
  findingId?: string;
  documentId?: string;
  db?: QueryRunner;
}): Promise<ReviewerSourceSnapshot> {
  const db = input.db ?? pool;
  const result = await db.query<{
    source_issue_id: string | null;
    finding_id: string | null;
    title: string;
    visibility: string;
    archived_at: Date | null;
    deleted_at: Date | null;
    properties: JsonRecord;
    content: JsonRecord;
    associations: JsonRecord[];
  }>(
    `WITH context AS (
       SELECT
         f.id AS finding_id,
         f.source_issue_id
       FROM fleetgraph_findings f
       WHERE f.workspace_id = $1
         AND f.id = $2::uuid
       UNION ALL
       SELECT
         NULL::uuid AS finding_id,
         d.id AS source_issue_id
       FROM documents d
       WHERE d.workspace_id = $1
         AND d.id = $3::uuid
         AND d.document_type = 'issue'
       LIMIT 1
     )
     SELECT
       context.finding_id,
       context.source_issue_id,
       issue.title,
       issue.visibility,
       issue.archived_at,
       issue.deleted_at,
       issue.properties,
       issue.content,
       COALESCE(associations.items, '[]'::jsonb) AS associations
     FROM context
     JOIN documents issue
       ON issue.id = context.source_issue_id
      AND issue.workspace_id = $1
      AND issue.document_type = 'issue'
     LEFT JOIN LATERAL (
       SELECT jsonb_agg(
                jsonb_build_object(
                  'relatedId', association.related_id,
                  'relationshipType', association.relationship_type
                )
                ORDER BY association.relationship_type, association.related_id
              ) AS items
         FROM document_associations association
        WHERE association.document_id = issue.id
     ) associations ON TRUE
     LIMIT 1`,
    [input.workspaceId, input.findingId ?? null, input.documentId ?? null]
  );
  const row = result.rows[0];
  if (!row) {
    return { sourceIssueId: null, findingId: input.findingId ?? null, state: {} };
  }
  return {
    sourceIssueId: row.source_issue_id,
    findingId: row.finding_id,
    state: {
      title: row.title,
      visibility: row.visibility,
      archived_at: row.archived_at?.toISOString() ?? null,
      deleted_at: row.deleted_at?.toISOString() ?? null,
      properties: row.properties,
      content: row.content,
      associations: row.associations,
    },
  };
}

export async function recordFleetGraphReviewerChatMutationProof(input: {
  workspaceId: string;
  before: ReviewerSourceSnapshot;
  after: ReviewerSourceSnapshot;
  chatRunId: string;
  db?: QueryRunner;
}): Promise<void> {
  if (!input.before.sourceIssueId || input.before.sourceIssueId !== input.after.sourceIssueId) return;
  const changedFields = changedSourceFields(input.before.state, input.after.state);
  await (input.db ?? pool).query(
    `INSERT INTO fleetgraph_reviewer_chat_proofs (
       workspace_id,
       source_issue_id,
       finding_id,
       chat_run_id,
       before_state,
       after_state,
       changed_fields
     )
     VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::text[])`,
    [
      input.workspaceId,
      input.before.sourceIssueId,
      input.before.findingId ?? input.after.findingId,
      input.chatRunId,
      JSON.stringify(input.before.state),
      JSON.stringify(input.after.state),
      changedFields,
    ]
  );
}

async function ensureReviewerSourceMutationProofAndReload(input: {
  workspaceId: string;
  principal: Principal;
  chain: FleetGraphReviewerChain;
  db: QueryRunner;
}): Promise<FleetGraphReviewerChain> {
  if (!input.chain.links.sourceIssueId || !input.chain.links.findingId) return input.chain;
  if (input.chain.sourceMutationCheck.passed) return input.chain;

  await ensureReviewerSourceMutationProof({
    workspaceId: input.workspaceId,
    principal: input.principal,
    sourceIssueId: input.chain.links.sourceIssueId,
    findingId: input.chain.links.findingId,
    db: input.db,
  });

  return (await loadReviewerChainsById({
    workspaceId: input.workspaceId,
    principal: input.principal,
    chainId: input.chain.chainId,
    db: input.db,
  }))[0] ?? input.chain;
}

async function ensureReviewerSourceMutationProof(input: {
  workspaceId: string;
  principal: Principal;
  sourceIssueId: string;
  findingId: string;
  db: QueryRunner;
}): Promise<void> {
  const before = await sourceSnapshotForReviewerChat({
    workspaceId: input.workspaceId,
    findingId: input.findingId,
    documentId: input.sourceIssueId,
    db: input.db,
  });
  const result = await runFleetGraph({
    workspaceId: input.workspaceId,
    principal: input.principal,
    mode: 'on_demand',
    trigger: {
      type: 'context_chat',
      prompt: 'For reviewer proof, explain why this FleetGraph finding needs human confirmation. Do not modify source documents.',
      context: {
        kind: 'finding',
        findingId: input.findingId,
        documentId: input.sourceIssueId,
        sourcePath: `/fleetgraph/reviewer?findingId=${input.findingId}`,
      },
    },
    triggerReason: 'reviewer-source-mutation-proof',
  }, { db: input.db, forceReviewerTrace: true });
  if (result.decision === 'error' || result.visibleOutput?.noSafeOutput) return;

  const after = await sourceSnapshotForReviewerChat({
    workspaceId: input.workspaceId,
    findingId: input.findingId,
    documentId: input.sourceIssueId,
    db: input.db,
  });
  await recordFleetGraphReviewerChatMutationProof({
    workspaceId: input.workspaceId,
    before,
    after,
    chatRunId: result.run.id,
    db: input.db,
  });
}

export async function generateFleetGraphReviewerProof(input: {
  workspaceId: string;
  principal: Principal;
  chainId?: string;
}): Promise<FleetGraphReviewerProofResponse> {
  const chain = input.chainId
    ? await getFleetGraphReviewerChain({
        workspaceId: input.workspaceId,
        principal: input.principal,
        chainId: input.chainId,
      })
    : await bestFleetGraphReviewerProofChain({
        workspaceId: input.workspaceId,
        principal: input.principal,
      });
  if (!chain) {
    throw new Error('No FleetGraph reviewer chain is available for proof generation.');
  }

  const artifact = await runReviewerProofCommand(chain);

  return {
    verdict: artifact.verdict,
    generatedAt: new Date().toISOString(),
    chainId: chain.chainId,
    artifactPaths: {
      json: 'my-docs/evidence/fleetgraph-proof/latest.json',
      markdown: 'my-docs/evidence/fleetgraph-proof/latest.md',
      html: 'my-docs/evidence/fleetgraph-proof/latest.html',
      publicJson: 'web/public/fleetgraph-observability/proof/latest.json',
      publicMarkdown: 'web/public/fleetgraph-observability/proof/latest.md',
      publicHtml: 'web/public/fleetgraph-observability/proof/latest.html',
    },
  };
}

async function bestFleetGraphReviewerProofChain(input: {
  workspaceId: string;
  principal: Principal;
}): Promise<FleetGraphReviewerChain | null> {
  const chains = await listFleetGraphReviewerChains({
    workspaceId: input.workspaceId,
    principal: input.principal,
    limit: 25,
  });
  return preferredReviewerProofChain(chains.chains);
}

export function preferredReviewerProofChain(chains: FleetGraphReviewerChain[]): FleetGraphReviewerChain | null {
  return chains.find((chain) => chain.scenario === 'week-blocker' && chain.status === 'complete')
    ?? chains.find((chain) => chain.status === 'complete')
    ?? chains.find((chain) => chain.scenario === 'week-blocker')
    ?? chains[0]
    ?? null;
}

async function runReviewerProofCommand(chain: FleetGraphReviewerChain): Promise<{ verdict: FleetGraphReviewerProofVerdict }> {
  const cwd = reviewerProofRepoRoot();
  const startedAt = new Date();
  try {
    await execFileAsync('pnpm', [
      'fleetgraph:proof',
      '--',
      '--mode',
      'local',
      '--no-refresh-evals',
      '--skip-tests',
    ], {
      cwd,
      timeout: 120_000,
      env: {
        ...proofCommandEnv(process.env),
        FLEETGRAPH_REVIEWER_CHAIN_ID: chain.chainId,
        FLEETGRAPH_REVIEWER_CHAIN_JSON: JSON.stringify(publicReviewerChainProof(chain)),
      },
    });
  } catch (err) {
    const artifact = await readProofArtifact(cwd, chain.chainId, startedAt);
    if (artifact?.verdict) {
      throw new ReviewerProofCommandError(`Proof packet verdict ${artifact.verdict}`, safeProofOutputTail(proofCommandOutput(err)));
    }
    throw reviewerProofCommandError(err);
  }
  const artifact = await readProofArtifact(cwd, chain.chainId, startedAt);
  if (!artifact?.verdict) {
    throw new ReviewerProofCommandError('Proof packet artifact was not written for the selected chain', []);
  }
  if (artifact.verdict !== 'pass') {
    throw new ReviewerProofCommandError(`Proof packet verdict ${artifact.verdict}`, []);
  }
  return { verdict: artifact.verdict };
}

export function reviewerProofRepoRoot(): string {
  if (process.env.FLEETGRAPH_PROOF_REPO_ROOT) return process.env.FLEETGRAPH_PROOF_REPO_ROOT;
  return path.basename(process.cwd()) === 'api'
    ? path.resolve(process.cwd(), '..')
    : process.cwd();
}

function reviewerProofCommandError(err: unknown): ReviewerProofCommandError {
  const output = proofCommandOutput(err);
  const tail = safeProofOutputTail(output);
  const summary = tail.find((line) => line.includes('FleetGraph proof check failed:'))
    ?? tail.find((line) => line.startsWith('FleetGraph proof '))
    ?? (err instanceof Error && err.message ? err.message.split('\n')[0] ?? 'Proof packet command failed.' : 'Proof packet command failed.');
  return new ReviewerProofCommandError(summary, tail);
}

function proofCommandOutput(err: unknown): string {
  const stdout = typeof Reflect.get(Object(err), 'stdout') === 'string'
    ? Reflect.get(Object(err), 'stdout') as string
    : '';
  const stderr = typeof Reflect.get(Object(err), 'stderr') === 'string'
    ? Reflect.get(Object(err), 'stderr') as string
    : '';
  if (stdout || stderr) return `${stdout}\n${stderr}`;
  return err instanceof Error ? err.message : String(err);
}

function safeProofOutputTail(output: string): string[] {
  const secretEnvPattern = /(TOKEN|SECRET|PASSWORD|KEY|DATABASE_URL|CONNECTION_STRING)/i;
  const envSecrets = Object.entries(process.env)
    .filter(([key, value]) => secretEnvPattern.test(key) && typeof value === 'string' && value.length >= 8)
    .map(([, value]) => value as string);
  return output
    .replace(/postgres(?:ql)?:\/\/[^\s]+/gi, '[redacted database url]')
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/g, 'Bearer [redacted]')
    .replace(/([A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|KEY|DATABASE_URL|CONNECTION_STRING)[A-Z0-9_]*)=\S+/gi, '$1=[redacted]')
    .replace(/([?&](?:token|key|secret|password)=)[^&\s]+/gi, '$1[redacted]')
    .split('\n')
    .map((line) => envSecrets.reduce((current, value) => current.replaceAll(value, '[redacted]'), line))
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-PROOF_OUTPUT_TAIL_LINES);
}

async function ensureWeekBlockerScenarioDocuments(input: {
  workspaceId: string;
  userId: string;
  issueTitle: string;
  db: QueryRunner;
}): Promise<ScenarioDocuments> {
  const currentWeek = await resolveFleetGraphCurrentWeek(input.workspaceId, { db: input.db });
  const sprint = await upsertReviewerSprint({
    ...input,
    sprintNumber: currentWeek.currentSprintNumber,
  });
  const issue = await upsertReviewerIssue({
    ...input,
    sprintId: sprint.id,
  });
  await addBelongsToAssociation(issue.id, sprint.id, 'sprint', input.db);
  await input.db.query(
    `INSERT INTO issue_iterations (
       workspace_id, issue_id, author_id, status, what_attempted, blockers_encountered
     )
     VALUES ($1, $2, $3, 'fail', 'Reviewer live proof scenario', $4)`,
    [input.workspaceId, issue.id, input.userId, REVIEWER_PROOF_BLOCKER_TEXT]
  );

  return {
    sourceIssueId: issue.id,
    sourceSprintId: sprint.id,
  };
}

async function upsertReviewerSprint(input: {
  workspaceId: string;
  userId: string;
  sprintNumber: number;
  db: QueryRunner;
}): Promise<{ id: string }> {
  const existing = await input.db.query<{ id: string }>(
    `SELECT id
       FROM documents
      WHERE workspace_id = $1
        AND document_type = 'sprint'
        AND title = $2
        AND deleted_at IS NULL
      LIMIT 1`,
    [input.workspaceId, REVIEWER_WEEK_TITLE]
  );
  if (existing.rows[0]) {
    await input.db.query(
      `UPDATE documents
          SET properties = properties || jsonb_build_object(
                'sprint_number', $3::int,
                'owner_id', $4::text,
                'reviewer_proof', true
              ),
              visibility = 'workspace',
              archived_at = NULL,
              updated_at = NOW()
        WHERE id = $1
          AND workspace_id = $2`,
      [existing.rows[0].id, input.workspaceId, input.sprintNumber, input.userId]
    );
    return existing.rows[0];
  }

  const created = await input.db.query<{ id: string }>(
    `INSERT INTO documents (workspace_id, document_type, title, properties, visibility, created_by)
     VALUES ($1, 'sprint', $2, $3::jsonb, 'workspace', $4)
     RETURNING id`,
    [
      input.workspaceId,
      REVIEWER_WEEK_TITLE,
      JSON.stringify({
        sprint_number: input.sprintNumber,
        owner_id: input.userId,
        reviewer_proof: true,
      }),
      input.userId,
    ]
  );
  return requireRow(created.rows[0], 'Failed to create reviewer sprint');
}

async function upsertReviewerIssue(input: {
  workspaceId: string;
  userId: string;
  sprintId: string;
  issueTitle: string;
  db: QueryRunner;
}): Promise<IssueRow> {
  const existing = await input.db.query<IssueRow>(
    `SELECT id, properties, updated_at
       FROM documents
      WHERE workspace_id = $1
        AND document_type = 'issue'
        AND title = $2
        AND deleted_at IS NULL
      LIMIT 1`,
    [input.workspaceId, input.issueTitle]
  );
  if (existing.rows[0]) {
    const updated = await input.db.query<IssueRow>(
      `UPDATE documents
          SET properties = properties || $3::jsonb,
              visibility = 'workspace',
              archived_at = NULL,
              updated_at = NOW()
        WHERE id = $1
          AND workspace_id = $2
      RETURNING id, properties, updated_at`,
      [
        existing.rows[0].id,
        input.workspaceId,
        JSON.stringify({
          state: 'blocked',
          priority: 'high',
          assignee_id: input.userId,
          reviewer_proof: true,
          reviewer_source_sprint_id: input.sprintId,
        }),
      ]
    );
    return requireRow(updated.rows[0], 'Failed to update reviewer issue');
  }

  const created = await input.db.query<IssueRow>(
    `INSERT INTO documents (workspace_id, document_type, title, properties, visibility, created_by)
     VALUES ($1, 'issue', $2, $3::jsonb, 'workspace', $4)
     RETURNING id, properties, updated_at`,
    [
      input.workspaceId,
      input.issueTitle,
      JSON.stringify({
        state: 'blocked',
        priority: 'high',
        assignee_id: input.userId,
        reviewer_proof: true,
        reviewer_source_sprint_id: input.sprintId,
      }),
      input.userId,
    ]
  );
  return requireRow(created.rows[0], 'Failed to create reviewer issue');
}

function freshReviewerIssueTitle(): string {
  return `${REVIEWER_ISSUE_TITLE} ${new Date().toISOString()}`;
}

function isReviewerIssueTitle(title: string | null): boolean {
  return Boolean(title?.startsWith(REVIEWER_ISSUE_TITLE) || title?.startsWith(LEGACY_REVIEWER_ISSUE_TITLE));
}

function requireRow<T>(row: T | undefined, message: string): T {
  if (!row) throw new Error(message);
  return row;
}

async function loadReviewerChains(input: {
  workspaceId: string;
  principal: Principal;
  limit: number;
  sourceIssueId?: string;
  db?: QueryRunner;
}): Promise<FleetGraphReviewerChain[]> {
  const db = input.db ?? pool;
  const rows = await queryChainRows({
    workspaceId: input.workspaceId,
    limit: input.limit,
    sourceIssueId: input.sourceIssueId,
    db,
  });
  const notificationFindings = await queryNotificationFindings({
    workspaceId: input.workspaceId,
    db,
  });

  const chains: FleetGraphReviewerChain[] = [];
  for (const row of rows) {
    chains.push(await chainFromRow({
      row,
      principal: input.principal,
      notificationFindings,
      db,
    }));
  }
  return chains;
}

async function loadReviewerChainsById(input: {
  workspaceId: string;
  principal: Principal;
  chainId: string;
  db?: QueryRunner;
}): Promise<FleetGraphReviewerChain[]> {
  const db = input.db ?? pool;
  const rows = await queryChainRows({
    workspaceId: input.workspaceId,
    limit: 1,
    chainId: input.chainId,
    db,
  });
  const notificationFindings = await queryNotificationFindings({
    workspaceId: input.workspaceId,
    db,
  });
  const chains: FleetGraphReviewerChain[] = [];
  for (const row of rows) {
    chains.push(await chainFromRow({
      row,
      principal: input.principal,
      notificationFindings,
      db,
    }));
  }
  return chains;
}

async function queryChainRows(input: {
  workspaceId: string;
  limit: number;
  sourceIssueId?: string;
  chainId?: string;
  db: QueryRunner;
}): Promise<ChainRow[]> {
  const result = await input.db.query<ChainRow>(
    `SELECT
       run.id AS run_id,
       run.created_at AS run_created_at,
       run.started_at AS run_started_at,
       run.completed_at AS run_completed_at,
       run.mode AS run_mode,
       run.trigger_reason,
       run.decision,
       run.dedupe_key,
       run.trace_metadata AS run_trace_metadata,
       run.token_metadata,
       run.cost_metadata,
       run.source_issue_id,
       run.source_sprint_id,
       finding.id AS finding_id,
       finding.status AS finding_status,
       finding.first_detected_at AS finding_first_detected_at,
       finding.last_detected_at AS finding_last_detected_at,
       finding.trace_metadata AS finding_trace_metadata,
       issue.title AS issue_title,
       issue.properties->>'state' AS issue_state,
       issue.properties->>'priority' AS issue_priority,
       issue.properties->>'assignee_id' AS issue_assignee_id,
       issue.updated_at AS issue_updated_at,
       sprint.title AS sprint_title,
       event.id AS attention_event_id,
       event.status AS attention_event_status,
       event.created_at AS attention_event_created_at,
       event.locked_at AS attention_event_locked_at,
       event.processed_at AS attention_event_processed_at,
       tick.id AS worker_tick_id,
       tick.status AS worker_tick_status,
       tick.started_at AS worker_tick_started_at,
       tick.completed_at AS worker_tick_completed_at,
       mutation.before_state AS mutation_before_state,
       mutation.after_state AS mutation_after_state,
       mutation.changed_fields AS mutation_changed_fields,
       mutation.created_at AS mutation_proof_created_at
     FROM fleetgraph_runs run
     LEFT JOIN fleetgraph_findings finding
       ON finding.id = run.finding_id
      AND finding.workspace_id = run.workspace_id
     LEFT JOIN documents issue
       ON issue.id = COALESCE(run.source_issue_id, finding.source_issue_id)
      AND issue.workspace_id = run.workspace_id
     LEFT JOIN documents sprint
       ON sprint.id = COALESCE(run.source_sprint_id, finding.source_sprint_id)
      AND sprint.workspace_id = run.workspace_id
     LEFT JOIN LATERAL (
       SELECT *
         FROM fleetgraph_attention_events event
        WHERE event.workspace_id = run.workspace_id
          AND event.source_issue_id = COALESCE(run.source_issue_id, finding.source_issue_id)
          AND event.status = 'completed'
          AND event.created_at <= run.created_at
          AND (
            event.source_sprint_id IS NULL
            OR event.source_sprint_id = COALESCE(run.source_sprint_id, finding.source_sprint_id)
          )
        ORDER BY ABS(EXTRACT(EPOCH FROM (run.created_at - event.created_at))) ASC
        LIMIT 1
     ) event ON TRUE
     LEFT JOIN LATERAL (
       SELECT *
         FROM fleetgraph_worker_ticks tick
        WHERE tick.started_at >= COALESCE(event.created_at, run.created_at) - interval '2 minutes'
          AND tick.started_at <= run.created_at + interval '2 minutes'
          AND tick.status = 'completed'
        ORDER BY ABS(EXTRACT(EPOCH FROM (run.created_at - tick.started_at))) ASC
        LIMIT 1
     ) tick ON TRUE
     LEFT JOIN LATERAL (
       SELECT proof.*
         FROM fleetgraph_reviewer_chat_proofs proof
         JOIN fleetgraph_runs proof_run
           ON proof_run.id = proof.chat_run_id
          AND proof_run.workspace_id = proof.workspace_id
          AND proof_run.source_issue_id = proof.source_issue_id
          AND proof_run.finding_id = proof.finding_id
          AND proof_run.trigger_reason = 'reviewer-source-mutation-proof'
        WHERE proof.workspace_id = run.workspace_id
          AND proof.source_issue_id = COALESCE(run.source_issue_id, finding.source_issue_id)
          AND proof.finding_id = finding.id
          AND proof.created_at >= run.created_at
        ORDER BY proof.created_at DESC
        LIMIT 1
     ) mutation ON TRUE
    WHERE run.workspace_id = $1
      AND ($3::uuid IS NULL OR COALESCE(run.source_issue_id, finding.source_issue_id) = $3::uuid)
      AND ($4::uuid IS NULL OR run.id = $4::uuid OR finding.id = $4::uuid)
    ORDER BY run.created_at DESC
    LIMIT $2`,
    [input.workspaceId, input.limit, input.sourceIssueId ?? null, input.chainId ?? null]
  );
  return result.rows;
}

async function queryNotificationFindings(input: {
  workspaceId: string;
  db: QueryRunner;
}): Promise<FleetGraphNotificationFinding[]> {
  const result = await input.db.query<FleetGraphNotificationFinding>(
    `SELECT f.*,
            issue.title AS issue_title,
            sprint.title AS context_title,
            assignee.name AS owner_name,
            NULL::timestamptz AS read_at
       FROM fleetgraph_findings f
       JOIN documents issue
         ON issue.id = f.source_issue_id
        AND issue.workspace_id = f.workspace_id
       LEFT JOIN documents sprint
         ON sprint.id = f.source_sprint_id
        AND sprint.workspace_id = f.workspace_id
       LEFT JOIN users assignee
         ON assignee.id = CASE
              WHEN issue.properties->>'assignee_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
              THEN (issue.properties->>'assignee_id')::uuid
              ELSE NULL
            END
      WHERE f.workspace_id = $1
        AND f.status IN ('open', 'needs_confirmation', 'error')
      ORDER BY f.last_detected_at DESC
      LIMIT 100`,
    [input.workspaceId]
  );
  return result.rows.map((row) => ({ ...row, confidence: Number(row.confidence) }));
}

async function chainFromRow(input: {
  row: ChainRow;
  principal: Principal;
  notificationFindings: FleetGraphNotificationFinding[];
  db: QueryRunner;
}): Promise<FleetGraphReviewerChain> {
  const { row } = input;
  const finding = row.finding_id ? await queryFinding(input.db, row.finding_id) : null;
  const visible = finding ? await visibleOutputForFinding({
    principal: input.principal,
    workspaceId: finding.workspace_id,
    finding,
    db: input.db,
  }) : null;
  const visibleOutput = visible && !visible.output.noSafeOutput ? visible.output : undefined;
  const traceMetadata = traceMetadataForResponse(row.run_trace_metadata, {
    mode: row.run_mode,
    decision: row.decision,
  });
  const notificationFinding = input.notificationFindings.find((candidate) => candidate.id === row.finding_id);
  const notificationProjection = notificationFinding && visibleOutput
    ? fleetGraphNotificationResponse({ finding: notificationFinding, visibleOutput })
    : undefined;
  const steps = stepsForRow(row, Boolean(visibleOutput), Boolean(notificationProjection), traceMetadata);
  const traceQuality = traceQualityForRow(row, traceMetadata);
  const latencyMs = latencyForRow(row);
  const sourceMutationCheck = sourceMutationCheckForRow(row);
  const blocking = blockingProblemsForChain(steps, traceQuality, latencyMs, sourceMutationCheck);
  const pending = pendingForChain(steps);
  const missing = [...new Set([...blocking, ...pending])];
  const status = statusForChain(blocking, pending, row);

  return {
    chainId: row.run_id,
    scenario: isReviewerIssueTitle(row.issue_title) ? 'week-blocker' : 'existing',
    status,
    missing,
    generatedAt: new Date().toISOString(),
    freshness: freshnessForRow(row),
    latencyMs,
    links: {
      ...(row.source_issue_id ? { sourceIssueId: row.source_issue_id } : {}),
      ...(row.source_sprint_id ? { sourceSprintId: row.source_sprint_id } : {}),
      ...(row.attention_event_id ? { attentionEventId: row.attention_event_id } : {}),
      ...(row.worker_tick_id ? { workerTickId: row.worker_tick_id } : {}),
      runId: row.run_id,
      ...(traceMetadata.traceId ? { traceId: traceMetadata.traceId } : {}),
      ...(traceMetadata.traceUrl ? { traceUrl: traceMetadata.traceUrl } : {}),
      ...(row.finding_id ? { findingId: row.finding_id } : {}),
      ...(notificationProjection ? { notificationProjectionId: notificationProjection.id } : {}),
      ...(row.run_mode === 'on_demand' ? { chatRunId: row.run_id } : {}),
    },
    steps,
    visibleOutput: visibleOutput ? serializeFleetGraphVisibleOutput(visibleOutput) : undefined,
    notificationProjection,
    humanGate: humanGateForVisibleOutput(visibleOutput),
    traceQuality,
    sourceMutationCheck,
    usageSummary: usageForRow(row),
  };
}

async function queryFinding(db: QueryRunner, findingId: string): Promise<FleetGraphFinding | null> {
  const result = await db.query<FleetGraphFinding>(
    `SELECT * FROM fleetgraph_findings WHERE id = $1 LIMIT 1`,
    [findingId]
  );
  return result.rows[0] ? { ...result.rows[0], confidence: Number(result.rows[0].confidence) } : null;
}

function stepsForRow(
  row: ChainRow,
  hasVisibleOutput: boolean,
  hasNotificationProjection: boolean,
  traceMetadata: ReturnType<typeof traceMetadataForResponse>
): FleetGraphReviewerStep[] {
  return [
    step('source', 'Ship source', row.source_issue_id ? 'pass' : 'broken', row.issue_updated_at, `Issue: ${row.issue_title ?? 'missing source'}`),
    step('attention_event', 'Attention event', row.attention_event_id && row.attention_event_status === 'completed' ? 'pass' : 'pending', row.attention_event_created_at, row.attention_event_status ?? 'No completed event row found'),
    step('worker_tick', 'Worker tick', row.worker_tick_id && row.worker_tick_status === 'completed' ? 'pass' : 'pending', row.worker_tick_started_at, row.worker_tick_status ?? 'No completed worker tick matched this run'),
    step('graph_run', 'Graph run', 'pass', row.run_created_at, `${row.decision} via ${row.trigger_reason}`),
    step('trace', 'Trace', traceMetadata.traceUrl ? 'pass' : 'broken', row.run_created_at, traceMetadata.traceUrl ? 'Safe trace URL captured' : 'Trace URL missing or unsafe'),
    step('finding', 'Finding', row.finding_id ? 'pass' : 'pending', row.finding_first_detected_at, row.finding_status ?? 'No finding persisted for this run'),
    step('notification_projection', 'Notification projection', hasNotificationProjection ? 'pass' : 'pending', row.finding_first_detected_at, hasNotificationProjection ? 'Derived from visible finding' : 'No visible notification projection'),
    step('chat_human_gate', 'Chat and human gate', hasVisibleOutput ? 'pass' : 'pending', row.run_completed_at, hasVisibleOutput ? 'Visible output contains human gate metadata' : 'No visible output for this actor'),
  ];
}

function step(
  key: string,
  label: string,
  status: FleetGraphReviewerStepStatus,
  at: Date | null,
  evidence: string
): FleetGraphReviewerStep {
  return {
    key,
    label,
    status,
    at: at?.toISOString() ?? null,
    evidence,
  };
}

function traceQualityForRow(
  row: ChainRow,
  traceMetadata: ReturnType<typeof traceMetadataForResponse>
): FleetGraphReviewerChain['traceQuality'] {
  const scores: FleetGraphReviewerTraceScore[] = [
    score('traceId', Boolean(traceMetadata.traceId), traceMetadata.traceId ?? null, 'Trace ID must be present.'),
    score('traceUrl', Boolean(traceMetadata.traceUrl), traceMetadata.traceUrl ?? null, 'Trace URL must be reviewer-safe.'),
    score('nodePath', traceMetadata.nodePath.length > 0, traceMetadata.nodePath.join(' -> '), 'Graph node path must not be empty.'),
    score('decision', Boolean(row.decision), row.decision, 'Run decision must be explicit.'),
    score('usageMetadata', row.token_metadata !== null && row.cost_metadata !== null, true, 'Usage and cost metadata must be persisted.'),
    score('createTraceNotQuiet', row.decision !== 'quiet_exit' || row.trigger_reason !== 'reviewer-week-blocker-scenario', row.decision, 'Scenario create proof cannot be satisfied by quiet exit.'),
  ];
  return {
    passed: scores.every((item) => item.passed),
    requiredDecisions: [row.decision],
    observedDecisions: [row.decision],
    scores,
  };
}

function score(
  name: string,
  passed: boolean,
  value: string | number | boolean | null,
  comment: string
): FleetGraphReviewerTraceScore {
  return { name, passed, value, comment };
}

function latencyForRow(row: ChainRow): FleetGraphReviewerChain['latencyMs'] {
  const ship = row.issue_updated_at;
  const attention = row.attention_event_created_at;
  const worker = row.worker_tick_started_at;
  const run = row.run_created_at;
  const finding = row.finding_first_detected_at;
  const notification = row.finding_first_detected_at;
  return {
    ...(ship && attention ? { shipToAttention: diffMs(ship, attention) } : {}),
    ...(attention && worker ? { attentionToWorker: diffMs(attention, worker) } : {}),
    ...(worker && run ? { workerToRun: diffMs(worker, run) } : {}),
    ...(run && finding ? { runToFinding: diffMs(run, finding) } : {}),
    ...(finding && notification ? { findingToNotification: diffMs(finding, notification) } : {}),
    ...(ship && notification ? { total: diffMs(ship, notification) } : {}),
  };
}

function diffMs(start: Date, end: Date): number {
  return normalizeCausalDiffMs(end.getTime() - start.getTime());
}

export function normalizeCausalDiffMs(value: number): number {
  if (value < 0 && Math.abs(value) <= CAUSAL_TIMESTAMP_SKEW_MS) return 0;
  return value;
}

function blockingProblemsForChain(
  steps: FleetGraphReviewerStep[],
  traceQuality: FleetGraphReviewerChain['traceQuality'],
  latencyMs: FleetGraphReviewerChain['latencyMs'],
  sourceMutationCheck: FleetGraphReviewerChain['sourceMutationCheck']
): string[] {
  const missing = steps
    .filter((stepItem) => stepItem.status === 'broken' || stepItem.status === 'failed')
    .map((stepItem) => stepItem.key);
  if (!traceQuality.passed) missing.push('trace_quality');
  if (latencyMs.total === undefined || latencyMs.total > LATENCY_GOAL_MS) missing.push('latency_under_5_minutes');
  if (Object.values(latencyMs).some((value) => typeof value === 'number' && value < 0)) missing.push('causal_ordering');
  if (!sourceMutationCheck.passed) missing.push('source_mutation_check');
  return [...new Set(missing)];
}

function pendingForChain(steps: FleetGraphReviewerStep[]): string[] {
  return steps
    .filter((stepItem) => REQUIRED_STEP_KEYS.has(stepItem.key) && stepItem.status === 'pending')
    .map((stepItem) => stepItem.key);
}

function statusForChain(
  blocking: string[],
  pending: string[],
  row: ChainRow
): FleetGraphReviewerChain['status'] {
  if (row.decision === 'error') return 'failed';
  if (blocking.length > 0) return 'broken';
  if (pending.length > 0) return 'in_progress';
  if (!row.finding_id && row.run_mode === 'proactive') return 'in_progress';
  return 'complete';
}

function freshnessForRow(row: ChainRow): FleetGraphReviewerChain['freshness'] {
  const now = Date.now();
  const newestRunAt = row.run_created_at;
  const newestWorkerTickAt = row.worker_tick_started_at;
  return {
    generatedAt: new Date().toISOString(),
    newestRunAt: newestRunAt?.toISOString() ?? null,
    newestWorkerTickAt: newestWorkerTickAt?.toISOString() ?? null,
    proofAgeMs: newestRunAt ? now - newestRunAt.getTime() : null,
    workerAgeMs: newestWorkerTickAt ? now - newestWorkerTickAt.getTime() : null,
  };
}

function humanGateForVisibleOutput(
  output: Awaited<ReturnType<typeof visibleOutputForFinding>>['output'] | undefined
): FleetGraphReviewerChain['humanGate'] {
  if (!output) {
    return { required: false, state: 'missing', allowedActions: [] };
  }
  const approvalRequired = output.humanGate?.approvalRequired === true || output.humanGate?.required === true;
  return {
    required: approvalRequired,
    state: Object.keys(output.humanGate ?? {}).length > 0 ? 'present' : 'missing',
    allowedActions: approvalRequired
      ? ['approve after review', 'edit source manually', 'dismiss', 'snooze']
      : ['inspect evidence'],
  };
}

function sourceMutationCheckForRow(row: ChainRow): FleetGraphReviewerChain['sourceMutationCheck'] {
  if (row.mutation_before_state && row.mutation_after_state && row.mutation_changed_fields) {
    return {
      passed: row.mutation_changed_fields.length === 0,
      before: sourceMutationState(row.mutation_before_state),
      after: sourceMutationState(row.mutation_after_state),
      changedFields: row.mutation_changed_fields,
    };
  }
  return {
    passed: false,
    before: {},
    after: {},
    changedFields: ['not_measured'],
  };
}

function sourceMutationState(value: JsonRecord | null): Record<string, string | number | boolean | null> {
  const state: Record<string, string | number | boolean | null> = {};
  for (const [key, item] of Object.entries(value ?? {})) {
    if (item === null || typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean') {
      state[key] = item;
    }
  }
  return state;
}

function changedSourceFields(before: JsonRecord, after: JsonRecord): string[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys].filter((key) => stableJson(before[key]) !== stableJson(after[key])).sort();
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(',')}}`;
}

function usageForRow(row: ChainRow): FleetGraphUsage {
  const token = row.token_metadata ?? {};
  const cost = row.cost_metadata ?? {};
  return {
    modelCalls: numberValue(token.modelCalls),
    inputTokens: optionalNumber(token.inputTokens),
    cachedInputTokens: optionalNumber(token.cachedInputTokens),
    billableInputTokens: optionalNumber(token.billableInputTokens),
    outputTokens: optionalNumber(token.outputTokens),
    totalTokens: optionalNumber(token.totalTokens),
    estimatedCostUsd: optionalNumber(cost.estimatedCostUsd),
    costCurrency: 'USD',
    usageSource: typeof token.usageSource === 'string' ? token.usageSource as FleetGraphUsage['usageSource'] : 'none',
    costSource: typeof cost.costSource === 'string' ? cost.costSource as FleetGraphUsage['costSource'] : 'none',
  };
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function reviewerSummary(chains: FleetGraphReviewerChain[]): FleetGraphReviewerChainsResponse['summary'] {
  const preferredChain = preferredReviewerProofChain(chains);
  const requiredGates: FleetGraphReviewerTraceScore[] = [
    score('canonicalChainComplete', preferredChain?.status === 'complete', preferredChain?.chainId ?? null, 'The selected canonical reviewer chain must complete.'),
    score('freshWorker', (preferredChain?.freshness.workerAgeMs ?? Infinity) <= LIVE_WORKER_FRESH_MS, true, 'Canonical worker tick must be recent for live pass.'),
    score('freshTrace', (preferredChain?.freshness.proofAgeMs ?? Infinity) <= TRACE_FRESH_MS, true, 'Canonical trace/run evidence must be fresh.'),
    score('latencyUnderFiveMinutes', (preferredChain?.latencyMs.total ?? Infinity) <= LATENCY_GOAL_MS, true, 'Canonical live scenario must surface under five minutes.'),
  ];
  const costSummary = chains.reduce<FleetGraphUsage>((total, chain) => ({
    modelCalls: total.modelCalls + chain.usageSummary.modelCalls,
    inputTokens: (total.inputTokens ?? 0) + (chain.usageSummary.inputTokens ?? 0),
    cachedInputTokens: (total.cachedInputTokens ?? 0) + (chain.usageSummary.cachedInputTokens ?? 0),
    billableInputTokens: (total.billableInputTokens ?? 0) + (chain.usageSummary.billableInputTokens ?? 0),
    outputTokens: (total.outputTokens ?? 0) + (chain.usageSummary.outputTokens ?? 0),
    totalTokens: (total.totalTokens ?? 0) + (chain.usageSummary.totalTokens ?? 0),
    estimatedCostUsd: (total.estimatedCostUsd ?? 0) + (chain.usageSummary.estimatedCostUsd ?? 0),
    costCurrency: 'USD',
    usageSource: 'none',
    costSource: 'none',
  }), { modelCalls: 0, costCurrency: 'USD' });

  return {
    generatedAt: new Date().toISOString(),
    status: requiredGates.every((gate) => gate.passed) ? 'complete' : 'broken',
    chainCount: chains.length,
    completeCount: chains.filter((chain) => chain.status === 'complete').length,
    brokenCount: chains.filter((chain) => chain.status === 'broken' || chain.status === 'failed').length,
    requiredGates,
    costSummary,
  };
}

export function proofCommandEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const childEnv = Object.fromEntries(
    Object.entries(env).filter(([key]) => PROOF_COMMAND_ENV_ALLOWLIST.has(key))
  );
  const testDatabaseUrl = env.FLEETGRAPH_PROOF_TEST_DATABASE_URL ?? fleetGraphProofTestDatabaseUrl(env.DATABASE_URL);
  if (testDatabaseUrl) {
    childEnv.FLEETGRAPH_PROOF_TEST_DATABASE_URL = testDatabaseUrl;
  }
  return childEnv;
}

function fleetGraphProofTestDatabaseUrl(databaseUrl: string | undefined): string | undefined {
  if (!databaseUrl) return undefined;
  try {
    const url = new URL(databaseUrl);
    url.pathname = '/ship_test_audit';
    return url.toString();
  } catch {
    return undefined;
  }
}

async function readProofArtifact(
  cwd: string,
  chainId: string,
  startedAt: Date
): Promise<ReviewerProofArtifact | null> {
  try {
    const artifactPath = path.join(cwd, 'my-docs/evidence/fleetgraph-proof/latest.json');
    const artifactStat = await stat(artifactPath);
    if (artifactStat.mtimeMs + 1000 < startedAt.getTime()) return null;
    const content = await readFile(artifactPath, 'utf8');
    const parsed = JSON.parse(content) as ReviewerProofArtifact;
    if (parsed.reviewerChain?.chainId !== chainId) return null;
    if (!['pass', 'blocked', 'fail', 'risk'].includes(String(parsed.verdict))) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function publicReviewerChainProof(chain: FleetGraphReviewerChain) {
  return {
    chainId: chain.chainId,
    scenario: chain.scenario,
    status: chain.status,
    missing: chain.missing,
    generatedAt: chain.generatedAt,
    freshness: chain.freshness,
    latencyMs: chain.latencyMs,
    steps: chain.steps.map((stepItem) => ({
      key: stepItem.key,
      label: stepItem.label,
      status: stepItem.status,
      at: stepItem.at,
      durationMs: stepItem.durationMs,
      evidence: stepItem.status === 'pass' ? 'Reviewer-safe evidence present.' : stepItem.evidence,
    })),
    humanGate: chain.humanGate,
    traceQuality: {
      ...chain.traceQuality,
      scores: chain.traceQuality.scores.map((item) => ({
        name: item.name,
        passed: item.passed,
        value: typeof item.value === 'boolean' || typeof item.value === 'number' ? item.value : null,
        comment: item.comment,
      })),
    },
    sourceMutationCheck: {
      passed: chain.sourceMutationCheck.passed,
      before: {},
      after: {},
      changedFields: chain.sourceMutationCheck.changedFields,
    },
    usageSummary: chain.usageSummary,
  };
}

function placeholderScenarioChain(input: {
  sourceIssueId: string;
  sourceSprintId: string;
  attentionEventId?: string;
}): FleetGraphReviewerChain {
  const generatedAt = new Date().toISOString();
  return {
    chainId: input.attentionEventId ?? input.sourceIssueId,
    scenario: 'week-blocker',
    status: 'in_progress',
    missing: ['graph_run', 'finding', 'notification_projection'],
    generatedAt,
    freshness: {
      generatedAt,
      newestRunAt: null,
      newestWorkerTickAt: null,
      proofAgeMs: null,
      workerAgeMs: null,
    },
    latencyMs: {},
    links: {
      sourceIssueId: input.sourceIssueId,
      sourceSprintId: input.sourceSprintId,
      ...(input.attentionEventId ? { attentionEventId: input.attentionEventId } : {}),
    },
    steps: [
      step('source', 'Ship source', 'pass', null, 'Reviewer issue exists.'),
      step('attention_event', 'Attention event', input.attentionEventId ? 'pass' : 'pending', null, 'Scenario event queued.'),
      step('graph_run', 'Graph run', 'pending', null, 'Waiting for worker output.'),
    ],
    humanGate: { required: false, state: 'missing', allowedActions: [] },
    traceQuality: {
      passed: false,
      requiredDecisions: [],
      observedDecisions: [],
      scores: [score('traceUrl', false, null, 'Waiting for trace URL.')],
    },
    sourceMutationCheck: {
      passed: false,
      before: {},
      after: {},
      changedFields: ['not_measured'],
    },
    usageSummary: { modelCalls: 0, costCurrency: 'USD' },
  };
}
