import { pool } from '../../db/client.js';
import { requireFirstRow } from '../../utils/query-rows.js';
import {
  fleetGraphAttentionDedupeKey,
  fleetGraphSignalType,
} from './dedupe.js';
import {
  jsonParam,
  mapFinding,
  type FleetGraphFinding,
  type FleetGraphFindingRow,
  type JsonRecord,
  type QueryRunner,
  type SaveBlockedImportantIssueFindingInput,
} from './types.js';

export async function saveBlockedImportantIssueFinding(
  input: SaveBlockedImportantIssueFindingInput,
  db: QueryRunner = pool
): Promise<FleetGraphFinding> {
  const signalType = fleetGraphSignalType(input.runMetadata?.signalType);
  const dedupeKey = fleetGraphAttentionDedupeKey({
    signalType,
    workspaceId: input.workspaceId,
    issueId: input.sourceIssueId,
    sprintId: input.sourceSprintId,
  });

  const result = await db.query<FleetGraphFindingRow>(
    `INSERT INTO fleetgraph_findings (
       workspace_id, source_issue_id, source_sprint_id, dedupe_key,
       status, severity, confidence, title, summary,
       evidence_snapshot, recommended_action, draft_content, proposed_recipient,
       human_gate, trace_metadata, run_metadata
     )
     VALUES (
       $1, $2, $3, $4,
       $5, $6, $7, $8, $9,
       $10::jsonb, $11::jsonb, $12::jsonb, $13::jsonb,
       $14::jsonb, $15::jsonb, $16::jsonb
     )
     ON CONFLICT (dedupe_key) WHERE status IN ('open', 'needs_confirmation', 'error')
     DO UPDATE SET
       status = EXCLUDED.status,
       severity = EXCLUDED.severity,
       confidence = EXCLUDED.confidence,
       title = EXCLUDED.title,
       summary = EXCLUDED.summary,
       evidence_snapshot = EXCLUDED.evidence_snapshot,
       recommended_action = EXCLUDED.recommended_action,
       draft_content = EXCLUDED.draft_content,
       proposed_recipient = EXCLUDED.proposed_recipient,
       human_gate = EXCLUDED.human_gate,
       trace_metadata = EXCLUDED.trace_metadata,
       run_metadata = EXCLUDED.run_metadata,
       last_detected_at = NOW(),
       resolved_at = NULL,
       dismissed_at = NULL,
       dismissed_by = NULL,
       updated_at = NOW()
     RETURNING *`,
    [
      input.workspaceId,
      input.sourceIssueId,
      input.sourceSprintId,
      dedupeKey,
      input.status ?? 'open',
      input.severity,
      input.confidence,
      input.title,
      input.summary,
      jsonParam(input.evidenceSnapshot ?? []),
      jsonParam(input.recommendedAction ?? {}),
      jsonParam(input.draftContent ?? {}),
      jsonParam(input.proposedRecipient ?? {}),
      jsonParam(input.humanGate ?? {}),
      jsonParam(input.traceMetadata ?? {}),
      jsonParam(input.runMetadata ?? {}),
    ]
  );

  return mapFinding(requireFirstRow(result.rows));
}

export async function refineFleetGraphDraft(
  input: {
    workspaceId: string;
    findingId: string;
    draftContent: JsonRecord;
    humanGate?: JsonRecord;
    traceMetadata?: JsonRecord;
  },
  db: QueryRunner = pool
): Promise<FleetGraphFinding | null> {
  const result = await db.query<FleetGraphFindingRow>(
    `UPDATE fleetgraph_findings
        SET draft_content = $3::jsonb,
            human_gate = COALESCE($4::jsonb, human_gate),
            trace_metadata = trace_metadata || COALESCE($5::jsonb, '{}'::jsonb),
            status = 'needs_confirmation',
            updated_at = NOW()
      WHERE id = $1
        AND workspace_id = $2
        AND status IN ('open', 'needs_confirmation')
      RETURNING *`,
    [
      input.findingId,
      input.workspaceId,
      jsonParam(input.draftContent),
      input.humanGate ? jsonParam(input.humanGate) : null,
      input.traceMetadata ? jsonParam(input.traceMetadata) : null,
    ]
  );

  return result.rows[0] ? mapFinding(result.rows[0]) : null;
}

export async function dismissFleetGraphFinding(
  input: { workspaceId: string; findingId: string; dismissedBy: string },
  db: QueryRunner = pool
): Promise<FleetGraphFinding | null> {
  const result = await db.query<FleetGraphFindingRow>(
    `UPDATE fleetgraph_findings
        SET status = 'dismissed',
            dismissed_at = NOW(),
            dismissed_by = $3,
            updated_at = NOW()
      WHERE id = $1
        AND workspace_id = $2
        AND status IN ('open', 'needs_confirmation', 'error')
      RETURNING *`,
    [input.findingId, input.workspaceId, input.dismissedBy]
  );

  return result.rows[0] ? mapFinding(result.rows[0]) : null;
}

export async function resolveFleetGraphFinding(
  input: { workspaceId: string; findingId: string },
  db: QueryRunner = pool
): Promise<FleetGraphFinding | null> {
  const result = await db.query<FleetGraphFindingRow>(
    `UPDATE fleetgraph_findings
        SET status = 'resolved',
            resolved_at = NOW(),
            updated_at = NOW()
      WHERE id = $1
        AND workspace_id = $2
        AND status IN ('open', 'needs_confirmation', 'error')
      RETURNING *`,
    [input.findingId, input.workspaceId]
  );

  return result.rows[0] ? mapFinding(result.rows[0]) : null;
}

export async function suppressFleetGraphFinding(
  input: { workspaceId: string; findingId: string },
  db: QueryRunner = pool
): Promise<FleetGraphFinding | null> {
  const result = await db.query<FleetGraphFindingRow>(
    `UPDATE fleetgraph_findings
        SET status = 'suppressed',
            updated_at = NOW()
      WHERE id = $1
        AND workspace_id = $2
        AND status IN ('open', 'needs_confirmation', 'error')
      RETURNING *`,
    [input.findingId, input.workspaceId]
  );

  return result.rows[0] ? mapFinding(result.rows[0]) : null;
}
