// Week-blocker scenario document setup and live proof runner.
import type { FleetGraphReviewerScenarioResponse } from '@ship/shared';
import { pool } from '../../db/client.js';
import type { Principal } from '../../security/principal.js';
import { addBelongsToAssociation } from '../../utils/document-crud.js';
import { resolveFleetGraphCurrentWeek } from '../detection/current-week.js';
import { enqueueFleetGraphAttentionEvent } from '../persistence.js';
import { runFleetGraphWorkerTick } from '../execution/worker.js';
import { placeholderScenarioChain } from './chain-build.js';
import { loadReviewerChains } from './chain-sql.js';
import { ensureReviewerSourceMutationProofAndReload } from './chat-mutation.js';
import {
  REVIEWER_ISSUE_TITLE,
  REVIEWER_PROOF_BLOCKER_TEXT,
  REVIEWER_WEEK_TITLE,
} from './constants.js';
import type { IssueRow, QueryRunner, ScenarioDocuments } from './types.js';
import { requireRow } from './types.js';

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

export async function ensureWeekBlockerScenarioDocuments(input: {
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
