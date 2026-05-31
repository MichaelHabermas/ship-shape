// SQL loaders for reviewer causal chain rows and notification findings.
import { pool } from '../../db/client.js';
import type { Principal } from '../../security/principal.js';
import type { FleetGraphNotificationFinding } from '../persistence.js';
import { chainFromRow } from './chain-build.js';
import type { ChainRow, QueryRunner } from './types.js';
import type { FleetGraphReviewerChain } from '@ship/shared';

export async function loadReviewerChains(input: {
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

export async function loadReviewerChainsById(input: {
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

export async function queryChainRows(input: {
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

export async function queryNotificationFindings(input: {
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
