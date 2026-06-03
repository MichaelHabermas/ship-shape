import { pool } from '../../db/client.js';
import {
  type ClaimFleetGraphAttentionEventsInput,
  type CompleteFleetGraphAttentionEventInput,
  type EnqueueFleetGraphAttentionEventInput,
  type FailFleetGraphAttentionEventInput,
  type FleetGraphAttentionEvent,
  type FleetGraphAttentionEventRow,
  type QueryRunner,
  type RetryFleetGraphAttentionEventInput,
} from './types.js';

const ATTENTION_EVENT_LEASE_TIMEOUT_MINUTES = 10;
const ATTENTION_EVENT_MAX_ATTEMPTS = 5;
const ATTENTION_EVENT_BASE_BACKOFF_MS = 30_000;
const ATTENTION_EVENT_MAX_BACKOFF_MS = 30 * 60_000;

function attentionEventRetryDelayMs(attemptCount: number): number {
  const exponent = Math.max(0, attemptCount - 1);
  return Math.min(
    ATTENTION_EVENT_BASE_BACKOFF_MS * (2 ** exponent),
    ATTENTION_EVENT_MAX_BACKOFF_MS
  );
}

function boundedLastError(error: string): string {
  return error.slice(0, 2_000);
}

export async function enqueueFleetGraphAttentionEvent(
  input: EnqueueFleetGraphAttentionEventInput,
  db: QueryRunner = pool
): Promise<FleetGraphAttentionEvent | null> {
  const result = await db.query<FleetGraphAttentionEventRow>(
    `INSERT INTO fleetgraph_attention_events (
       workspace_id, source_issue_id, source_sprint_id, event_type, reason, available_at
     )
     VALUES ($1, $2, $3, $4, $5, COALESCE($6, NOW()))
     ON CONFLICT (
       workspace_id,
       source_issue_id,
       source_sprint_key,
       event_type
     ) WHERE status IN ('pending', 'processing')
     DO UPDATE SET
       reason = EXCLUDED.reason,
       available_at = LEAST(fleetgraph_attention_events.available_at, EXCLUDED.available_at),
       updated_at = NOW()
     RETURNING *`,
    [
      input.workspaceId,
      input.sourceIssueId,
      input.sourceSprintId ?? null,
      input.eventType,
      input.reason,
      input.availableAt ?? null,
    ]
  );

  return result.rows[0] ?? null;
}

export async function claimFleetGraphAttentionEvents(
  input: ClaimFleetGraphAttentionEventsInput,
  db: QueryRunner = pool
): Promise<FleetGraphAttentionEvent[]> {
  const workspaceIds = input.workspaceIds && input.workspaceIds.length > 0 ? input.workspaceIds : null;
  const result = await db.query<FleetGraphAttentionEventRow>(
    `WITH claimed AS (
       SELECT id
         FROM fleetgraph_attention_events
        WHERE (
            status = 'pending'
            OR (
              status = 'processing'
              AND locked_at <= COALESCE($3, NOW()) - ($4::int || ' minutes')::interval
            )
          )
          AND available_at <= COALESCE($3, NOW())
          AND ($5::uuid[] IS NULL OR workspace_id = ANY($5::uuid[]))
        ORDER BY available_at ASC, created_at ASC
        LIMIT $1
        FOR UPDATE SKIP LOCKED
     )
     UPDATE fleetgraph_attention_events event
        SET status = 'processing',
            locked_at = NOW(),
            locked_by = $2,
            attempt_count = attempt_count + 1,
            updated_at = NOW()
       FROM claimed
      WHERE event.id = claimed.id
      RETURNING event.*`,
    [
      input.limit ?? 10,
      input.lockedBy,
      input.now ?? null,
      input.leaseTimeoutMinutes ?? ATTENTION_EVENT_LEASE_TIMEOUT_MINUTES,
      workspaceIds,
    ]
  );

  return result.rows;
}

export async function completeFleetGraphAttentionEvent(
  input: CompleteFleetGraphAttentionEventInput,
  db: QueryRunner = pool
): Promise<FleetGraphAttentionEvent | null> {
  const result = await db.query<FleetGraphAttentionEventRow>(
    `UPDATE fleetgraph_attention_events
        SET status = $2,
            last_error = $3,
            processed_at = NOW(),
            locked_at = NULL,
            locked_by = NULL,
            updated_at = NOW()
      WHERE id = $1
        AND status = 'processing'
      RETURNING *`,
    [input.eventId, input.status, input.lastError ?? null]
  );

  return result.rows[0] ?? null;
}

export async function retryFleetGraphAttentionEvent(
  input: RetryFleetGraphAttentionEventInput,
  db: QueryRunner = pool
): Promise<FleetGraphAttentionEvent | null> {
  const result = await db.query<FleetGraphAttentionEventRow>(
    `UPDATE fleetgraph_attention_events
        SET status = 'pending',
            last_error = $2,
            available_at = COALESCE($3, NOW() + INTERVAL '1 minute'),
            locked_at = NULL,
            locked_by = NULL,
            updated_at = NOW()
      WHERE id = $1
        AND status = 'processing'
      RETURNING *`,
    [input.eventId, input.lastError, input.availableAt ?? null]
  );

  return result.rows[0] ?? null;
}

export async function failFleetGraphAttentionEvent(
  input: FailFleetGraphAttentionEventInput,
  db: QueryRunner = pool
): Promise<FleetGraphAttentionEvent | null> {
  const maxAttempts = input.maxAttempts ?? ATTENTION_EVENT_MAX_ATTEMPTS;
  const eventResult = await db.query<{ attempt_count: number }>(
    `SELECT attempt_count
       FROM fleetgraph_attention_events
      WHERE id = $1
        AND status = 'processing'
      LIMIT 1`,
    [input.eventId]
  );
  const attemptCount = eventResult.rows[0]?.attempt_count;
  if (attemptCount === undefined) return null;

  const terminal = attemptCount >= maxAttempts;
  const availableAt = terminal
    ? null
    : new Date((input.now ?? new Date()).getTime() + attentionEventRetryDelayMs(attemptCount));
  const result = await db.query<FleetGraphAttentionEventRow>(
    `UPDATE fleetgraph_attention_events
        SET status = CASE WHEN $3::boolean THEN 'failed' ELSE 'pending' END,
            last_error = $2,
            available_at = COALESCE($4, available_at),
            processed_at = CASE WHEN $3::boolean THEN NOW() ELSE NULL END,
            locked_at = NULL,
            locked_by = NULL,
            updated_at = NOW()
      WHERE id = $1
        AND status = 'processing'
      RETURNING *`,
    [input.eventId, boundedLastError(input.lastError), terminal, availableAt]
  );

  return result.rows[0] ?? null;
}
