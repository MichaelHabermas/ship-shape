/** Shared week/sprint helpers (supervisor lookup, accountability broadcasts). */
import { pool } from '../../db/client.js';
import { broadcastToUser } from '../../collaboration/index.js';

/**
 * Look up the reports_to user_id for a sprint's owner.
 * The sprint's owner_id is a person document ID; this resolves their supervisor's user_id.
 */
export async function getSprintOwnerReportsTo(
  sprintId: string,
  workspaceId: string,
): Promise<string | null> {
  const result = await pool.query<{ reports_to: string | null }>(
    `SELECT owner_person.properties->>'reports_to' as reports_to
     FROM documents d
     LEFT JOIN documents owner_person
       ON d.properties->>'owner_id' IS NOT NULL
       AND owner_person.id = (d.properties->>'owner_id')::uuid
       AND owner_person.document_type = 'person'
       AND owner_person.workspace_id = $2
     WHERE d.id = $1 AND d.workspace_id = $2 AND d.document_type = 'sprint'`,
    [sprintId, workspaceId],
  );
  return result.rows[0]?.reports_to ?? null;
}

/**
 * Broadcast accountability refresh to the sprint owner (if they have a user account).
 */
export async function broadcastAccountabilityUpdateToSprintOwner(
  sprintOwnerId: string | null | undefined,
  targetId: string,
  type: string,
): Promise<void> {
  if (!sprintOwnerId) return;

  const ownerUserResult = await pool.query<{ user_id: string | null }>(
    `SELECT properties->>'user_id' as user_id FROM documents WHERE id = $1`,
    [sprintOwnerId],
  );
  const ownerUserId = ownerUserResult.rows[0]?.user_id;
  if (!ownerUserId) return;

  broadcastToUser(ownerUserId, 'accountability:updated', { type, targetId });
}
