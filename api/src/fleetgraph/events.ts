// FleetGraph event helpers enqueue durable attention rechecks without blocking Ship writes.
import { pool } from '../db/client.js';
import {
  enqueueFleetGraphAttentionEvent,
  type FleetGraphAttentionEventType,
  type JsonRecord,
} from './persistence.js';

type QueryRunner = Pick<typeof pool, 'query'>;
type Logger = Pick<typeof console, 'warn'>;

function safeErrorMetadata(error: unknown): JsonRecord {
  if (error instanceof Error) return { name: error.name, message: error.message };
  return { message: String(error) };
}

export async function listIssueSprintIdsForFleetGraphEvent(
  input: { workspaceId: string; issueId: string; db?: QueryRunner }
): Promise<string[]> {
  const db = input.db ?? pool;
  const result = await db.query<{ sprint_id: string }>(
    `SELECT related_id AS sprint_id
       FROM document_associations
      WHERE document_id = $1
        AND relationship_type = 'sprint'
        AND EXISTS (
          SELECT 1
            FROM documents sprint
           WHERE sprint.id = document_associations.related_id
             AND sprint.workspace_id = $2
             AND sprint.document_type = 'sprint'
             AND sprint.deleted_at IS NULL
             AND sprint.archived_at IS NULL
        )`,
    [input.issueId, input.workspaceId]
  );

  return result.rows.map((row) => row.sprint_id);
}

export async function enqueueFleetGraphIssueAttentionEvents(input: {
  workspaceId: string;
  issueIds: string[];
  eventType: FleetGraphAttentionEventType;
  reason: string;
  db?: QueryRunner;
  logger?: Logger;
}): Promise<void> {
  const db = input.db ?? pool;
  const logger = input.logger ?? console;
  const issueIds = [...new Set(input.issueIds)].filter(Boolean);

  for (const issueId of issueIds) {
    try {
      const sprintIds = await listIssueSprintIdsForFleetGraphEvent({
        workspaceId: input.workspaceId,
        issueId,
        db,
      });
      const sourceSprintIds = sprintIds.length > 0 ? sprintIds : [null];
      for (const sourceSprintId of sourceSprintIds) {
        await enqueueFleetGraphAttentionEvent({
          workspaceId: input.workspaceId,
          sourceIssueId: issueId,
          sourceSprintId,
          eventType: input.eventType,
          reason: input.reason,
        }, db);
      }
    } catch (error) {
      logger.warn('[FleetGraph] Failed to enqueue attention event', {
        workspaceId: input.workspaceId,
        issueId,
        eventType: input.eventType,
        ...safeErrorMetadata(error),
      });
    }
  }
}
