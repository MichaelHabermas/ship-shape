// FleetGraph deterministic detectors select candidate work before graph reasoning.
import type { FleetGraphSignalType } from '@ship/shared';
import { pool } from '../../db/client.js';
import {
  BLOCKED_IMPORTANT_ISSUE_DEDUPE_PREFIX,
  AT_RISK_ISSUE_DEDUPE_PREFIX,
  STALE_ISSUE_DEDUPE_PREFIX,
  blockedImportantIssueDedupeKey,
  fleetGraphAttentionDedupeKey,
  recordFleetGraphRun,
  signalLabelForType,
  sqlBlockedImportantIssueDedupeKey,
} from '../persistence.js';
import { listFleetGraphIssueAttentionContexts, type FleetGraphIssueAttentionContext } from './attention-context.js';
import {
  AT_RISK_SPRINT_END_DAYS,
  attentionPolicyForContext,
  isWithinCurrentSprintEndWindow,
} from './attention-policy.js';
import { resolveFleetGraphCurrentWeek } from './current-week.js';

type QueryRunner = Pick<typeof pool, 'query'>;
type SourceKey = `${string}:${string}:${string}`;

const STALE_ISSUE_DAYS = 180;
type BlockedImportantIssueCandidateRow = {
  workspace_id: string;
  issue_id: string;
  issue_title: string;
  issue_ticket_number: number | null;
  issue_state: string | null;
  issue_priority: 'low' | 'medium' | 'high' | 'urgent';
  issue_assignee_id: string | null;
  issue_assignee_name: string | null;
  sprint_id: string;
  sprint_title: string;
  sprint_number: number | null;
  sprint_owner_id: string | null;
  sprint_owner_name: string | null;
  project_id: string | null;
  project_title: string | null;
  project_owner_id: string | null;
  project_owner_name: string | null;
  program_id: string | null;
  program_title: string | null;
  program_owner_id: string | null;
  program_owner_name: string | null;
  blocker_text: string;
  blocker_iteration_id: string | null;
  blocker_iteration_created_at: Date | null;
  meaningful_updated_at?: Date | null;
  attention_reason?: string | null;
  signal_type?: FleetGraphSignalType;
};

export type BlockedImportantIssueCandidate = BlockedImportantIssueCandidateRow & {
  dedupeKey: string;
  signalType?: FleetGraphSignalType;
  signalLabel?: string;
  attentionReason?: string;
  meaningfulUpdatedAt?: Date | null;
};

export type FleetGraphDetectorQuietExitReason =
  | 'done_or_cancelled'
  | 'duplicate_open_finding'
  | 'insufficient_visible_evidence';

export type FleetGraphDetectorQuietExit = {
  reason: FleetGraphDetectorQuietExitReason;
  count: number;
};

export type BlockedImportantIssueDedupeDecision = {
  decision: 'create_finding' | 'update_finding';
  candidate: BlockedImportantIssueCandidate;
  existingFindingId: string | null;
};

export type FleetGraphAttentionDedupeDecision = BlockedImportantIssueDedupeDecision;

export type BlockedImportantIssueDecisionBatch = {
  decisions: BlockedImportantIssueDedupeDecision[];
};

export type FleetGraphStaleFinding = {
  findingId: string;
  sourceIssueId: string;
  sourceSprintId: string;
  dedupeKey: string;
  reason: FleetGraphDetectorQuietExitReason | 'condition_gone';
};

function mapCandidate(row: BlockedImportantIssueCandidateRow): BlockedImportantIssueCandidate {
  const signalType = row.signal_type ?? 'blocked';
  return {
    ...row,
    signalType,
    signalLabel: signalLabelForType(signalType),
    attentionReason: row.attention_reason || (signalType === 'blocked' ? 'Issue state is blocked.' : 'Issue needs attention.'),
    meaningfulUpdatedAt: row.meaningful_updated_at ?? row.blocker_iteration_created_at ?? null,
    dedupeKey: signalType === 'blocked' ? blockedImportantIssueDedupeKey({
      workspaceId: row.workspace_id,
      issueId: row.issue_id,
      sprintId: row.sprint_id,
    }) : fleetGraphAttentionDedupeKey({
      signalType,
      workspaceId: row.workspace_id,
      issueId: row.issue_id,
      sprintId: row.sprint_id,
    }),
  };
}

function candidateFromContext(
  context: FleetGraphIssueAttentionContext,
  policy: NonNullable<ReturnType<typeof attentionPolicyForContext>>
): BlockedImportantIssueCandidate {
  return mapCandidate({
    workspace_id: context.workspace_id,
    issue_id: context.issue_id,
    issue_title: context.issue_title,
    issue_ticket_number: context.issue_ticket_number,
    issue_state: context.issue_state,
    issue_priority: context.issue_priority,
    issue_assignee_id: context.issue_assignee_id,
    issue_assignee_name: context.issue_assignee_name,
    sprint_id: context.sprint_id,
    sprint_title: context.sprint_title,
    sprint_number: context.sprint_number,
    sprint_owner_id: context.sprint_owner_id,
    sprint_owner_name: context.sprint_owner_name,
    project_id: context.project_id,
    project_title: context.project_title,
    project_owner_id: context.project_owner_id,
    project_owner_name: context.project_owner_name,
    program_id: context.program_id,
    program_title: context.program_title,
    program_owner_id: context.program_owner_id,
    program_owner_name: context.program_owner_name,
    blocker_text: context.blocker_text,
    blocker_iteration_id: context.blocker_iteration_id,
    blocker_iteration_created_at: context.blocker_iteration_created_at,
    meaningful_updated_at: context.meaningful_updated_at,
    attention_reason: policy.reason,
    signal_type: policy.signalType,
  });
}

async function findAttentionCandidatesFromContexts(input: {
  workspaceId: string;
  db?: QueryRunner;
  today?: Date;
  limit?: number;
  sourceIssueId?: string;
  sourceSprintId?: string | null;
  includePrivate?: boolean;
}): Promise<BlockedImportantIssueCandidate[]> {
  const db = input.db ?? pool;
  const today = input.today ?? new Date();
  const currentWeek = await resolveFleetGraphCurrentWeek(input.workspaceId, { db, today });
  const contexts = await listFleetGraphIssueAttentionContexts({
    workspaceId: input.workspaceId,
    sourceIssueId: input.sourceIssueId,
    sourceSprintId: input.sourceSprintId,
    includePrivate: input.includePrivate,
    limit: input.limit,
    db,
  });

  return strongestCandidatePerSource(contexts.flatMap((context) => {
    const policy = attentionPolicyForContext({
      context,
      today,
      currentSprintNumber: currentWeek.currentSprintNumber,
      workspaceStartDate: currentWeek.workspaceStartDate,
    });
    return policy ? [candidateFromContext(context, policy)] : [];
  }));
}

async function findBlockedImportantIssueCandidates(input: {
  workspaceId: string;
  db?: QueryRunner;
  today?: Date;
  limit?: number;
}): Promise<BlockedImportantIssueCandidate[]> {
  const db = input.db ?? pool;
  const result = await db.query<BlockedImportantIssueCandidateRow>(
    `SELECT
       i.workspace_id,
       i.id AS issue_id,
       i.title AS issue_title,
       i.ticket_number AS issue_ticket_number,
       i.properties->>'state' AS issue_state,
       CASE i.properties->>'priority'
         WHEN 'urgent' THEN 'urgent'
         WHEN 'high' THEN 'high'
         WHEN 'medium' THEN 'medium'
         WHEN 'low' THEN 'low'
       ELSE 'medium'
       END AS issue_priority,
       NULLIF(i.properties->>'assignee_id', '') AS issue_assignee_id,
       assignee.name AS issue_assignee_name,
       s.id AS sprint_id,
       s.title AS sprint_title,
       CASE
         WHEN s.properties->>'sprint_number' ~ '^\\d+$' THEN (s.properties->>'sprint_number')::int
         ELSE NULL
       END AS sprint_number,
       COALESCE(
         NULLIF(s.properties->>'owner_id', ''),
         NULLIF(s.properties->'assignee_ids'->>0, '')
       ) AS sprint_owner_id,
       sprint_owner.name AS sprint_owner_name,
       project.id AS project_id,
       project.title AS project_title,
       COALESCE(project_owner.id::text, project_owner_person_user.id::text, NULLIF(project.properties->>'owner_id', '')) AS project_owner_id,
       COALESCE(project_owner.name, project_owner_person_user.name, project_owner_person.title) AS project_owner_name,
       program.id AS program_id,
       program.title AS program_title,
       COALESCE(program_owner.id::text, program_owner_person_user.id::text, NULLIF(program.properties->>'owner_id', '')) AS program_owner_id,
       COALESCE(program_owner.name, program_owner_person_user.name, program_owner_person.title) AS program_owner_name,
       COALESCE(latest_iteration.blockers_encountered, '') AS blocker_text,
       latest_iteration.id AS blocker_iteration_id,
       latest_iteration.created_at AS blocker_iteration_created_at,
       latest_iteration.created_at AS meaningful_updated_at,
       CASE
         WHEN COALESCE(latest_iteration.blockers_encountered, '') = '' THEN 'Issue is blocked, but no blocker reason is recorded.'
         ELSE 'Issue state is blocked.'
       END AS attention_reason,
       'blocked'::text AS signal_type
     FROM documents i
     JOIN document_associations sprint_assoc
       ON sprint_assoc.document_id = i.id
      AND sprint_assoc.relationship_type = 'sprint'
     JOIN documents s
       ON s.id = sprint_assoc.related_id
      AND s.workspace_id = i.workspace_id
      AND s.document_type = 'sprint'
      AND s.deleted_at IS NULL
      AND s.archived_at IS NULL
      LEFT JOIN LATERAL (
       SELECT iteration.id, iteration.blockers_encountered, iteration.created_at
         FROM issue_iterations iteration
        WHERE iteration.issue_id = i.id
          AND iteration.workspace_id = i.workspace_id
          AND btrim(COALESCE(iteration.blockers_encountered, '')) <> ''
        ORDER BY iteration.created_at DESC, iteration.id DESC
        LIMIT 1
     ) latest_iteration ON TRUE
     LEFT JOIN users assignee
       ON assignee.id = CASE
            WHEN i.properties->>'assignee_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
            THEN (i.properties->>'assignee_id')::uuid
            ELSE NULL
          END
     LEFT JOIN users sprint_owner
       ON sprint_owner.id = CASE
            WHEN COALESCE(NULLIF(s.properties->>'owner_id', ''), NULLIF(s.properties->'assignee_ids'->>0, '')) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
            THEN COALESCE(NULLIF(s.properties->>'owner_id', ''), NULLIF(s.properties->'assignee_ids'->>0, ''))::uuid
            ELSE NULL
          END
     LEFT JOIN LATERAL (
       SELECT p.*
         FROM document_associations project_assoc
         JOIN documents p
           ON p.id = project_assoc.related_id
          AND p.workspace_id = i.workspace_id
          AND p.document_type = 'project'
          AND p.deleted_at IS NULL
          AND p.archived_at IS NULL
        WHERE project_assoc.document_id = i.id
          AND project_assoc.relationship_type = 'project'
        ORDER BY project_assoc.created_at DESC
        LIMIT 1
     ) project ON TRUE
     LEFT JOIN users project_owner
       ON project_owner.id = CASE
            WHEN project.properties->>'owner_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
            THEN (project.properties->>'owner_id')::uuid
            ELSE NULL
          END
     LEFT JOIN documents project_owner_person
       ON project_owner_person.id = CASE
            WHEN project.properties->>'owner_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
            THEN (project.properties->>'owner_id')::uuid
            ELSE NULL
          END
      AND project_owner_person.workspace_id = i.workspace_id
      AND project_owner_person.document_type = 'person'
      AND project_owner_person.deleted_at IS NULL
      AND project_owner_person.archived_at IS NULL
     LEFT JOIN users project_owner_person_user
       ON project_owner_person_user.id = CASE
            WHEN project_owner_person.properties->>'user_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
            THEN (project_owner_person.properties->>'user_id')::uuid
            ELSE NULL
          END
     LEFT JOIN LATERAL (
       SELECT p.*
         FROM document_associations program_assoc
         JOIN documents p
           ON p.id = program_assoc.related_id
          AND p.workspace_id = i.workspace_id
          AND p.document_type = 'program'
          AND p.deleted_at IS NULL
          AND p.archived_at IS NULL
        WHERE program_assoc.relationship_type = 'program'
          AND program_assoc.document_id IN (i.id, project.id, s.id)
        ORDER BY
          CASE program_assoc.document_id
            WHEN i.id THEN 1
            WHEN project.id THEN 2
            ELSE 3
          END,
          program_assoc.created_at DESC
        LIMIT 1
     ) program ON TRUE
     LEFT JOIN users program_owner
       ON program_owner.id = CASE
            WHEN program.properties->>'owner_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
            THEN (program.properties->>'owner_id')::uuid
            ELSE NULL
          END
     LEFT JOIN documents program_owner_person
       ON program_owner_person.id = CASE
            WHEN program.properties->>'owner_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
            THEN (program.properties->>'owner_id')::uuid
            ELSE NULL
          END
      AND program_owner_person.workspace_id = i.workspace_id
      AND program_owner_person.document_type = 'person'
      AND program_owner_person.deleted_at IS NULL
      AND program_owner_person.archived_at IS NULL
     LEFT JOIN users program_owner_person_user
       ON program_owner_person_user.id = CASE
            WHEN program_owner_person.properties->>'user_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
            THEN (program_owner_person.properties->>'user_id')::uuid
            ELSE NULL
          END
     WHERE i.workspace_id = $1
       AND i.document_type = 'issue'
       AND i.deleted_at IS NULL
       AND i.archived_at IS NULL
       AND COALESCE(i.visibility, 'workspace') <> 'private'
       AND COALESCE(i.properties->>'state', 'backlog') = 'blocked'
     ORDER BY
       CASE i.properties->>'priority'
         WHEN 'urgent' THEN 1
         WHEN 'high' THEN 2
         WHEN 'medium' THEN 3
         WHEN 'low' THEN 4
         ELSE 5
       END,
       latest_iteration.created_at DESC NULLS LAST,
       i.updated_at DESC
     LIMIT $2`,
    [input.workspaceId, input.limit ?? 25]
  );

  return result.rows.map(mapCandidate);
}

function uniqueCandidatesByDedupeKey(
  candidates: BlockedImportantIssueCandidate[]
): BlockedImportantIssueCandidate[] {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    if (seen.has(candidate.dedupeKey)) return false;
    seen.add(candidate.dedupeKey);
    return true;
  });
}

function sourceKey(candidate: BlockedImportantIssueCandidate): SourceKey {
  return `${candidate.workspace_id}:${candidate.issue_id}:${candidate.sprint_id}`;
}

function signalRank(candidate: BlockedImportantIssueCandidate): number {
  if ((candidate.signalType ?? 'blocked') === 'blocked') return 3;
  if (candidate.signalType === 'at_risk') return 2;
  return 1;
}

function strongestCandidatePerSource(
  candidates: BlockedImportantIssueCandidate[]
): BlockedImportantIssueCandidate[] {
  const bySource = new Map<SourceKey, BlockedImportantIssueCandidate>();
  for (const candidate of candidates) {
    const key = sourceKey(candidate);
    const existing = bySource.get(key);
    if (!existing || signalRank(candidate) > signalRank(existing)) bySource.set(key, candidate);
  }
  return [...bySource.values()];
}

async function planBlockedImportantIssueDedupeDecisions(input: {
  workspaceId: string;
  candidates: BlockedImportantIssueCandidate[];
  db?: QueryRunner;
}): Promise<BlockedImportantIssueDedupeDecision[]> {
  const candidates = uniqueCandidatesByDedupeKey(input.candidates);
  if (candidates.length === 0) return [];

  const db = input.db ?? pool;
  const dedupeKeys = candidates.map((candidate) => candidate.dedupeKey);
  const result = await db.query<{ id: string; dedupe_key: string }>(
    `SELECT id, dedupe_key
       FROM fleetgraph_findings
      WHERE workspace_id = $1
        AND dedupe_key = ANY($2::text[])
        AND status IN ('open', 'needs_confirmation', 'error')`,
    [input.workspaceId, dedupeKeys]
  );
  const openFindingIdByDedupeKey = new Map(
    result.rows.map((row) => [row.dedupe_key, row.id])
  );

  return candidates.map((candidate) => {
    const existingFindingId = openFindingIdByDedupeKey.get(candidate.dedupeKey) ?? null;
    return {
      decision: existingFindingId ? 'update_finding' : 'create_finding',
      candidate,
      existingFindingId,
    };
  });
}

export async function detectBlockedImportantIssueDecisions(input: {
  workspaceId: string;
  db?: QueryRunner;
  today?: Date;
  limit?: number;
}): Promise<BlockedImportantIssueDedupeDecision[]> {
  const candidates = await findBlockedImportantIssueCandidates(input);
  return planBlockedImportantIssueDedupeDecisions({
    workspaceId: input.workspaceId,
    candidates,
    db: input.db,
  });
}

async function findIssueAttentionCandidates(input: {
  workspaceId: string;
  db?: QueryRunner;
  today?: Date;
  limit?: number;
  signalType: Exclude<FleetGraphSignalType, 'blocked'>;
  currentSprintNumber?: number;
  finalSprintWindow?: boolean;
}): Promise<BlockedImportantIssueCandidate[]> {
  const db = input.db ?? pool;
  const staleDays = input.signalType === 'stale' ? STALE_ISSUE_DAYS : AT_RISK_SPRINT_END_DAYS;
  const result = await db.query<BlockedImportantIssueCandidateRow>(
    `SELECT
       i.workspace_id,
       i.id AS issue_id,
       i.title AS issue_title,
       i.ticket_number AS issue_ticket_number,
       i.properties->>'state' AS issue_state,
       CASE i.properties->>'priority'
         WHEN 'urgent' THEN 'urgent'
         WHEN 'high' THEN 'high'
         WHEN 'medium' THEN 'medium'
         WHEN 'low' THEN 'low'
       ELSE 'medium'
       END AS issue_priority,
       NULLIF(i.properties->>'assignee_id', '') AS issue_assignee_id,
       assignee.name AS issue_assignee_name,
       s.id AS sprint_id,
       s.title AS sprint_title,
       CASE
         WHEN s.properties->>'sprint_number' ~ '^\\d+$' THEN (s.properties->>'sprint_number')::int
         ELSE NULL
       END AS sprint_number,
       COALESCE(NULLIF(s.properties->>'owner_id', ''), NULLIF(s.properties->'assignee_ids'->>0, '')) AS sprint_owner_id,
       sprint_owner.name AS sprint_owner_name,
       project.id AS project_id,
       project.title AS project_title,
       COALESCE(project_owner.id::text, project_owner_person_user.id::text, NULLIF(project.properties->>'owner_id', '')) AS project_owner_id,
       COALESCE(project_owner.name, project_owner_person_user.name, project_owner_person.title) AS project_owner_name,
       program.id AS program_id,
       program.title AS program_title,
       COALESCE(program_owner.id::text, program_owner_person_user.id::text, NULLIF(program.properties->>'owner_id', '')) AS program_owner_id,
       COALESCE(program_owner.name, program_owner_person_user.name, program_owner_person.title) AS program_owner_name,
       '' AS blocker_text,
       latest_iteration.id AS blocker_iteration_id,
       latest_iteration.created_at AS blocker_iteration_created_at,
       COALESCE(latest_iteration.created_at, i.created_at) AS meaningful_updated_at,
       CASE
         WHEN $3::text = 'stale' THEN CONCAT('No meaningful update for ', $4::int, '+ days.')
         WHEN NULLIF(i.properties->>'assignee_id', '') IS NULL THEN 'High-priority current-week work has no owner.'
         ELSE CONCAT('High-priority current-week work is within ', $4::int, ' days of sprint end.')
       END AS attention_reason,
       $3::text AS signal_type
     FROM documents i
     JOIN document_associations sprint_assoc
       ON sprint_assoc.document_id = i.id
      AND sprint_assoc.relationship_type = 'sprint'
     JOIN documents s
       ON s.id = sprint_assoc.related_id
      AND s.workspace_id = i.workspace_id
      AND s.document_type = 'sprint'
      AND s.deleted_at IS NULL
      AND s.archived_at IS NULL
     LEFT JOIN LATERAL (
       SELECT iteration.id, iteration.created_at
         FROM issue_iterations iteration
        WHERE iteration.issue_id = i.id
          AND iteration.workspace_id = i.workspace_id
        ORDER BY iteration.created_at DESC, iteration.id DESC
        LIMIT 1
     ) latest_iteration ON TRUE
     LEFT JOIN users assignee
       ON assignee.id = CASE
            WHEN i.properties->>'assignee_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
            THEN (i.properties->>'assignee_id')::uuid
            ELSE NULL
          END
     LEFT JOIN users sprint_owner
       ON sprint_owner.id = CASE
            WHEN COALESCE(NULLIF(s.properties->>'owner_id', ''), NULLIF(s.properties->'assignee_ids'->>0, '')) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
            THEN COALESCE(NULLIF(s.properties->>'owner_id', ''), NULLIF(s.properties->'assignee_ids'->>0, ''))::uuid
            ELSE NULL
          END
     LEFT JOIN LATERAL (
       SELECT p.*
         FROM document_associations project_assoc
         JOIN documents p
           ON p.id = project_assoc.related_id
          AND p.workspace_id = i.workspace_id
          AND p.document_type = 'project'
          AND p.deleted_at IS NULL
          AND p.archived_at IS NULL
        WHERE project_assoc.document_id = i.id
          AND project_assoc.relationship_type = 'project'
        ORDER BY project_assoc.created_at DESC
        LIMIT 1
     ) project ON TRUE
     LEFT JOIN users project_owner
       ON project_owner.id = CASE
            WHEN project.properties->>'owner_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
            THEN (project.properties->>'owner_id')::uuid
            ELSE NULL
          END
     LEFT JOIN documents project_owner_person
       ON project_owner_person.id = CASE
            WHEN project.properties->>'owner_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
            THEN (project.properties->>'owner_id')::uuid
            ELSE NULL
          END
      AND project_owner_person.workspace_id = i.workspace_id
      AND project_owner_person.document_type = 'person'
      AND project_owner_person.deleted_at IS NULL
      AND project_owner_person.archived_at IS NULL
     LEFT JOIN users project_owner_person_user
       ON project_owner_person_user.id = CASE
            WHEN project_owner_person.properties->>'user_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
            THEN (project_owner_person.properties->>'user_id')::uuid
            ELSE NULL
          END
     LEFT JOIN LATERAL (
       SELECT p.*
         FROM document_associations program_assoc
         JOIN documents p
           ON p.id = program_assoc.related_id
          AND p.workspace_id = i.workspace_id
          AND p.document_type = 'program'
          AND p.deleted_at IS NULL
          AND p.archived_at IS NULL
        WHERE program_assoc.relationship_type = 'program'
          AND program_assoc.document_id IN (i.id, project.id, s.id)
        ORDER BY
          CASE program_assoc.document_id
            WHEN i.id THEN 1
            WHEN project.id THEN 2
            ELSE 3
          END,
          program_assoc.created_at DESC
        LIMIT 1
     ) program ON TRUE
     LEFT JOIN users program_owner
       ON program_owner.id = CASE
            WHEN program.properties->>'owner_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
            THEN (program.properties->>'owner_id')::uuid
            ELSE NULL
          END
     LEFT JOIN documents program_owner_person
       ON program_owner_person.id = CASE
            WHEN program.properties->>'owner_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
            THEN (program.properties->>'owner_id')::uuid
            ELSE NULL
          END
      AND program_owner_person.workspace_id = i.workspace_id
      AND program_owner_person.document_type = 'person'
      AND program_owner_person.deleted_at IS NULL
      AND program_owner_person.archived_at IS NULL
     LEFT JOIN users program_owner_person_user
       ON program_owner_person_user.id = CASE
            WHEN program_owner_person.properties->>'user_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
            THEN (program_owner_person.properties->>'user_id')::uuid
            ELSE NULL
          END
     WHERE i.workspace_id = $1
       AND i.document_type = 'issue'
       AND i.deleted_at IS NULL
       AND i.archived_at IS NULL
       AND COALESCE(i.visibility, 'workspace') <> 'private'
       AND COALESCE(i.properties->>'state', 'backlog') NOT IN ('done', 'cancelled', 'blocked')
       AND (
         ($3::text = 'stale'
          AND COALESCE(i.properties->>'state', 'backlog') IN ('in_progress', 'in_review')
          AND COALESCE(latest_iteration.created_at, i.created_at) <= ($2::timestamptz - ($4::int || ' days')::interval))
         OR
         ($3::text = 'at_risk'
          AND (s.properties->>'sprint_number') ~ '^\\d+$'
          AND (s.properties->>'sprint_number')::int = $5::int
          AND COALESCE(i.properties->>'priority', 'medium') IN ('high', 'urgent')
          AND (
            NULLIF(i.properties->>'assignee_id', '') IS NULL
            OR $7::boolean
          ))
       )
     ORDER BY
       CASE i.properties->>'priority'
         WHEN 'urgent' THEN 1
         WHEN 'high' THEN 2
         WHEN 'medium' THEN 3
         WHEN 'low' THEN 4
         ELSE 5
       END,
       meaningful_updated_at ASC,
       i.updated_at DESC
     LIMIT $6`,
    [
      input.workspaceId,
      input.today ?? new Date(),
      input.signalType,
      staleDays,
      input.currentSprintNumber ?? null,
      input.limit ?? 25,
      input.finalSprintWindow === true,
    ]
  );

  return result.rows.map(mapCandidate);
}

export async function detectFleetGraphAttentionDecisions(input: {
  workspaceId: string;
  db?: QueryRunner;
  today?: Date;
  limit?: number;
}): Promise<FleetGraphAttentionDedupeDecision[]> {
  const db = input.db ?? pool;
  const candidates = await findAttentionCandidatesFromContexts({
    ...input,
    db,
    limit: input.limit ?? 75,
  });
  return planBlockedImportantIssueDedupeDecisions({
    workspaceId: input.workspaceId,
    candidates,
    db,
  });
}

export async function detectFleetGraphAttentionDecisionsForSource(input: {
  workspaceId: string;
  sourceIssueId: string;
  sourceSprintId?: string | null;
  db?: QueryRunner;
  today?: Date;
}): Promise<FleetGraphAttentionDedupeDecision[]> {
  const db = input.db ?? pool;
  const candidates = await findAttentionCandidatesFromContexts({
    workspaceId: input.workspaceId,
    sourceIssueId: input.sourceIssueId,
    sourceSprintId: input.sourceSprintId,
    includePrivate: false,
    limit: 25,
    today: input.today,
    db,
  });

  return planBlockedImportantIssueDedupeDecisions({
    workspaceId: input.workspaceId,
    candidates,
    db,
  });
}

export async function findBlockedImportantIssueQuietExits(input: {
  workspaceId: string;
  db?: QueryRunner;
  today?: Date;
}): Promise<FleetGraphDetectorQuietExit[]> {
  const db = input.db ?? pool;

  const result = await db.query<{ reason: FleetGraphDetectorQuietExitReason; count: string }>(
    `WITH issue_week_context AS (
       SELECT
         i.workspace_id,
         i.id AS issue_id,
         COALESCE(i.properties->>'state', 'backlog') AS issue_state,
         COALESCE(i.properties->>'priority', 'medium') AS issue_priority,
         NULLIF(i.properties->>'assignee_id', '') AS issue_assignee_id,
         s.id AS sprint_id,
         CASE
           WHEN s.properties->>'sprint_number' ~ '^\\d+$' THEN (s.properties->>'sprint_number')::int
           ELSE NULL
         END AS sprint_number,
         COALESCE(
           NULLIF(s.properties->>'owner_id', ''),
           NULLIF(s.properties->'assignee_ids'->>0, '')
         ) AS sprint_owner_id,
         COALESCE(latest_iteration.blockers_encountered, '') AS blocker_text,
         blocked_finding.id AS duplicate_finding_id
       FROM documents i
       JOIN document_associations sprint_assoc
         ON sprint_assoc.document_id = i.id
        AND sprint_assoc.relationship_type = 'sprint'
       JOIN documents s
         ON s.id = sprint_assoc.related_id
        AND s.workspace_id = i.workspace_id
        AND s.document_type = 'sprint'
        AND s.deleted_at IS NULL
        AND s.archived_at IS NULL
       LEFT JOIN LATERAL (
         SELECT iteration.blockers_encountered, iteration.created_at
           FROM issue_iterations iteration
          WHERE iteration.issue_id = i.id
            AND iteration.workspace_id = i.workspace_id
            AND btrim(COALESCE(iteration.blockers_encountered, '')) <> ''
          ORDER BY iteration.created_at DESC, iteration.id DESC
          LIMIT 1
       ) latest_iteration ON TRUE
       LEFT JOIN fleetgraph_findings blocked_finding
         ON blocked_finding.workspace_id = i.workspace_id
        AND blocked_finding.dedupe_key = ${sqlBlockedImportantIssueDedupeKey('i.workspace_id', 'i.id', 's.id')}
        AND blocked_finding.status IN ('open', 'needs_confirmation', 'error')
       WHERE i.workspace_id = $1
         AND i.document_type = 'issue'
         AND i.deleted_at IS NULL
         AND i.archived_at IS NULL
       ),
       private_blocked_context AS (
       SELECT
         i.workspace_id,
         i.id AS issue_id
       FROM documents i
       JOIN document_associations sprint_assoc
         ON sprint_assoc.document_id = i.id
        AND sprint_assoc.relationship_type = 'sprint'
       JOIN documents s
         ON s.id = sprint_assoc.related_id
        AND s.workspace_id = i.workspace_id
        AND s.document_type = 'sprint'
        AND s.deleted_at IS NULL
        AND s.archived_at IS NULL
       LEFT JOIN LATERAL (
         SELECT iteration.blockers_encountered, iteration.created_at
           FROM issue_iterations iteration
          WHERE iteration.issue_id = i.id
            AND iteration.workspace_id = i.workspace_id
            AND btrim(COALESCE(iteration.blockers_encountered, '')) <> ''
          ORDER BY iteration.created_at DESC, iteration.id DESC
          LIMIT 1
       ) latest_iteration ON TRUE
       WHERE i.workspace_id = $1
         AND i.document_type = 'issue'
         AND i.deleted_at IS NULL
         AND i.archived_at IS NULL
         AND COALESCE(i.visibility, 'workspace') = 'private'
         AND COALESCE(i.properties->>'state', 'backlog') = 'blocked'
     ),
     classified AS (
       SELECT 'duplicate_open_finding'::text AS reason
         FROM issue_week_context
       WHERE issue_state = 'blocked'
         AND duplicate_finding_id IS NOT NULL
       UNION ALL
       SELECT 'insufficient_visible_evidence'::text AS reason
         FROM private_blocked_context
     )
     SELECT reason, COUNT(*)::text AS count
       FROM classified
     GROUP BY reason
     ORDER BY reason`,
    [input.workspaceId]
  );

  const countsByReason = new Map(result.rows.map((row) => [row.reason, Number(row.count)]));
  return [
    'done_or_cancelled',
    'duplicate_open_finding',
    'insufficient_visible_evidence',
  ].map((reason) => ({
    reason: reason as FleetGraphDetectorQuietExitReason,
    count: countsByReason.get(reason as FleetGraphDetectorQuietExitReason) ?? 0,
  }));
}

export async function findStaleBlockedImportantIssueFindings(input: {
  workspaceId: string;
  db?: QueryRunner;
  today?: Date;
  limit?: number;
}): Promise<FleetGraphStaleFinding[]> {
  const db = input.db ?? pool;
  const today = input.today ?? new Date();
  const currentWeek = await resolveFleetGraphCurrentWeek(input.workspaceId, { db, today });
  const candidates = strongestCandidatePerSource([
    ...(await findBlockedImportantIssueCandidates({
      ...input,
      db,
      today,
      limit: input.limit ?? 1000,
    })),
    ...(await findIssueAttentionCandidates({
      ...input,
      db,
      today,
      limit: input.limit ?? 1000,
      signalType: 'stale',
    })),
    ...(await findIssueAttentionCandidates({
      ...input,
      db,
      today,
      limit: input.limit ?? 1000,
      signalType: 'at_risk',
      currentSprintNumber: currentWeek.currentSprintNumber,
      finalSprintWindow: isWithinCurrentSprintEndWindow({
        workspaceStartDate: currentWeek.workspaceStartDate,
        today,
      }),
    })),
  ]);
  const activeDedupeKeys = new Set(candidates.map((candidate) => candidate.dedupeKey));

  const result = await db.query<{
    id: string;
    source_issue_id: string;
    source_sprint_id: string;
    dedupe_key: string;
    reason: FleetGraphStaleFinding['reason'];
  }>(
    `WITH open_findings AS (
       SELECT id, source_issue_id, source_sprint_id, dedupe_key
         FROM fleetgraph_findings
        WHERE workspace_id = $1
          AND (
            dedupe_key LIKE '${BLOCKED_IMPORTANT_ISSUE_DEDUPE_PREFIX}:%'
            OR dedupe_key LIKE '${STALE_ISSUE_DEDUPE_PREFIX}:%'
            OR dedupe_key LIKE '${AT_RISK_ISSUE_DEDUPE_PREFIX}:%'
          )
          AND status IN ('open', 'needs_confirmation', 'error')
        ORDER BY updated_at ASC
        LIMIT $2
     ),
     source_context AS (
       SELECT
         f.id,
         f.source_issue_id,
         f.source_sprint_id,
         f.dedupe_key,
         i.id AS issue_id,
         s.id AS sprint_id,
         COALESCE(i.properties->>'state', 'backlog') AS issue_state,
         COALESCE(i.properties->>'priority', 'medium') AS issue_priority,
         NULLIF(i.properties->>'assignee_id', '') AS issue_assignee_id,
         CASE
           WHEN s.properties->>'sprint_number' ~ '^\\d+$' THEN (s.properties->>'sprint_number')::int
           ELSE NULL
         END AS sprint_number,
         COALESCE(
           NULLIF(s.properties->>'owner_id', ''),
           NULLIF(s.properties->'assignee_ids'->>0, '')
         ) AS sprint_owner_id,
         COALESCE(latest_iteration.blockers_encountered, '') AS blocker_text,
         COALESCE(i.visibility, 'workspace') AS issue_visibility
       FROM open_findings f
       LEFT JOIN documents i
         ON i.id = f.source_issue_id
        AND i.workspace_id = $1
        AND i.document_type = 'issue'
        AND i.deleted_at IS NULL
        AND i.archived_at IS NULL
       LEFT JOIN documents s
         ON s.id = f.source_sprint_id
        AND s.workspace_id = $1
        AND s.document_type = 'sprint'
        AND s.deleted_at IS NULL
        AND s.archived_at IS NULL
       LEFT JOIN LATERAL (
         SELECT iteration.blockers_encountered
           FROM issue_iterations iteration
          WHERE iteration.issue_id = i.id
            AND iteration.workspace_id = i.workspace_id
            AND btrim(COALESCE(iteration.blockers_encountered, '')) <> ''
          ORDER BY iteration.created_at DESC, iteration.id DESC
          LIMIT 1
       ) latest_iteration ON TRUE
     )
     SELECT
       id,
       source_issue_id,
       source_sprint_id,
       dedupe_key,
       CASE
         WHEN issue_id IS NULL OR sprint_id IS NULL THEN 'condition_gone'
         WHEN issue_visibility = 'private' THEN 'insufficient_visible_evidence'
         WHEN issue_state IN ('done', 'cancelled') THEN 'done_or_cancelled'
         WHEN dedupe_key LIKE '${BLOCKED_IMPORTANT_ISSUE_DEDUPE_PREFIX}:%' AND issue_state <> 'blocked' THEN 'condition_gone'
         WHEN dedupe_key LIKE '${STALE_ISSUE_DEDUPE_PREFIX}:%' AND issue_state IN ('done', 'cancelled', 'blocked') THEN 'condition_gone'
         WHEN dedupe_key LIKE '${AT_RISK_ISSUE_DEDUPE_PREFIX}:%' AND issue_state IN ('done', 'cancelled', 'blocked') THEN 'condition_gone'
         ELSE 'condition_gone'
       END AS reason
     FROM source_context`,
    [input.workspaceId, input.limit ?? 100]
  );

  return result.rows
    .filter((row) => !activeDedupeKeys.has(row.dedupe_key))
    .map((row) => ({
      findingId: row.id,
      sourceIssueId: row.source_issue_id,
      sourceSprintId: row.source_sprint_id,
      dedupeKey: row.dedupe_key,
      reason: row.reason,
    }));
}

export async function recordBlockedImportantIssueQuietExitRun(input: {
  workspaceId: string;
  quietExits: FleetGraphDetectorQuietExit[];
  db?: QueryRunner;
}): Promise<void> {
  await recordFleetGraphRun({
    workspaceId: input.workspaceId,
    mode: 'proactive',
    triggerReason: 'blocked-important-issue-detector',
    decision: 'quiet_exit',
    outputSnapshot: {
      quietExits: input.quietExits,
    },
    tokenMetadata: {
      modelCalls: 0,
    },
    costMetadata: {
      modelCostUsd: 0,
    },
    completedAt: new Date(),
  }, input.db ?? pool);
}
