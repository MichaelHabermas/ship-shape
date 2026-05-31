// Chat mutation snapshots and source-mutation proof persistence.
import type { FleetGraphReviewerChain } from '@ship/shared';
import { pool } from '../../db/client.js';
import type { Principal } from '../../security/principal.js';
import { runFleetGraph } from '../core.js';
import { loadReviewerChainsById } from './chain-sql.js';
import type { JsonRecord } from '../persistence.js';
import type { QueryRunner, ReviewerSourceSnapshot } from './types.js';

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

export async function ensureReviewerSourceMutationProofAndReload(input: {
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
