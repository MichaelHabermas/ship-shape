import { pool } from '../../db/client.js';
import { requireFirstRow } from '../../utils/query-rows.js';
import {
  jsonParam,
  type CompleteFleetGraphWorkerTickInput,
  type FleetGraphRun,
  type FleetGraphRunRow,
  type FleetGraphWorkerTick,
  type FleetGraphWorkerTickRow,
  type QueryRunner,
  type RecordFleetGraphRunInput,
} from './types.js';

export async function recordFleetGraphRun(
  input: RecordFleetGraphRunInput,
  db: QueryRunner = pool
): Promise<FleetGraphRun> {
  const result = await db.query<FleetGraphRunRow>(
    `INSERT INTO fleetgraph_runs (
       workspace_id, finding_id, source_issue_id, source_sprint_id,
       mode, trigger_reason, decision, dedupe_key,
       input_snapshot, evidence_snapshot, output_snapshot, trace_metadata,
       token_metadata, cost_metadata, error_metadata, completed_at
     )
     VALUES (
       $1, $2, $3, $4,
       $5, $6, $7, $8,
       $9::jsonb, $10::jsonb, $11::jsonb, $12::jsonb,
       $13::jsonb, $14::jsonb, $15::jsonb, COALESCE($16, NOW())
     )
     RETURNING *`,
    [
      input.workspaceId,
      input.findingId ?? null,
      input.sourceIssueId ?? null,
      input.sourceSprintId ?? null,
      input.mode,
      input.triggerReason,
      input.decision,
      input.dedupeKey ?? null,
      jsonParam(input.inputSnapshot ?? {}),
      jsonParam(input.evidenceSnapshot ?? []),
      jsonParam(input.outputSnapshot ?? {}),
      jsonParam(input.traceMetadata ?? {}),
      jsonParam(input.tokenMetadata ?? {}),
      jsonParam(input.costMetadata ?? {}),
      jsonParam(input.errorMetadata ?? {}),
      input.completedAt ?? null,
    ]
  );

  return requireFirstRow(result.rows);
}

export async function listFleetGraphAnchorRuns(
  input: { workspaceId: string; findingId: string; limit?: number },
  db: QueryRunner = pool
): Promise<FleetGraphRun[]> {
  const result = await db.query<FleetGraphRunRow>(
    `SELECT *
       FROM fleetgraph_runs
      WHERE workspace_id = $1
        AND finding_id = $2
        AND decision IN ('create_finding', 'update_finding')
      ORDER BY created_at DESC
      LIMIT $3`,
    [input.workspaceId, input.findingId, input.limit ?? 2]
  );

  return result.rows;
}

export async function startFleetGraphWorkerTick(
  input: { instanceId: string; deadlineAt: Date },
  db: QueryRunner = pool
): Promise<FleetGraphWorkerTick> {
  const result = await db.query<FleetGraphWorkerTickRow>(
    `INSERT INTO fleetgraph_worker_ticks (instance_id, status, deadline_at)
     VALUES ($1, 'running', $2)
     RETURNING *`,
    [input.instanceId, input.deadlineAt]
  );

  return requireFirstRow(result.rows);
}

export async function heartbeatFleetGraphWorkerTick(
  tickId: string,
  db: QueryRunner = pool
): Promise<FleetGraphWorkerTick | null> {
  const result = await db.query<FleetGraphWorkerTickRow>(
    `UPDATE fleetgraph_worker_ticks
        SET heartbeat_at = NOW()
      WHERE id = $1
        AND status = 'running'
      RETURNING *`,
    [tickId]
  );

  return result.rows[0] ?? null;
}

export async function completeFleetGraphWorkerTick(
  input: CompleteFleetGraphWorkerTickInput,
  db: QueryRunner = pool
): Promise<FleetGraphWorkerTick | null> {
  const result = await db.query<FleetGraphWorkerTickRow>(
    `UPDATE fleetgraph_worker_ticks
        SET status = $2,
            completed_at = NOW(),
            heartbeat_at = NOW(),
            workspace_count = COALESCE($3, workspace_count),
            detector_decision_count = COALESCE($4, detector_decision_count),
            result_count = COALESCE($5, result_count),
            model_call_count = COALESCE($6, model_call_count),
            error_metadata = COALESCE($7::jsonb, error_metadata),
            audit_metadata = COALESCE($8::jsonb, audit_metadata)
      WHERE id = $1
        AND status = 'running'
      RETURNING *`,
    [
      input.tickId,
      input.status,
      input.workspaceCount ?? null,
      input.detectorDecisionCount ?? null,
      input.resultCount ?? null,
      input.modelCallCount ?? null,
      input.errorMetadata ? jsonParam(input.errorMetadata) : null,
      input.auditMetadata ? jsonParam(input.auditMetadata) : null,
    ]
  );

  return result.rows[0] ?? null;
}
