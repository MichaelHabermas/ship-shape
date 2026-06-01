import { pool } from '../db/client.js';

interface User {
  id: string;
  name: string;
}

interface Invite {
  id: string;
  workspace_id: string;
  email: string | null;
  role: string;
}

type DocumentIdRow = {
  id: string;
};

/**
 * Links a user to a workspace via an invite, handling person document creation/update.
 *
 * This is the single source of truth for invite acceptance logic, used by both:
 * - Password auth (invites.ts)
 * - PIV/CAIA auth (caia-auth.ts)
 *
 * Handles:
 * 1. Creating workspace membership
 * 2. Finding/updating person doc by EMAIL (not user_id) to handle orphaned docs
 * 3. Marking invite as used
 * 4. Cleaning up orphaned pending person docs
 */
export async function linkUserToWorkspaceViaInvite(
  user: User,
  invite: Invite
): Promise<{ personDocId: string; isNewMembership: boolean }> {
  // Email is required for person doc lookup - invites always have email
  const email = invite.email;
  if (!email) {
    throw new Error('Invite email is required for workspace linking');
  }

  // Check if user is already a member
  const existingMembership = await pool.query(
    'SELECT id FROM workspace_memberships WHERE workspace_id = $1 AND user_id = $2',
    [invite.workspace_id, user.id]
  );

  const isNewMembership = !existingMembership.rows[0];

  if (isNewMembership) {
    // Create membership
    await pool.query(
      `INSERT INTO workspace_memberships (workspace_id, user_id, role)
       VALUES ($1, $2, $3)`,
      [invite.workspace_id, user.id, invite.role]
    );
  }

  // Find existing person doc by EMAIL (handles orphaned docs from deleted users)
  const existingPersonDoc = await pool.query<DocumentIdRow>(
    `SELECT id FROM documents
     WHERE workspace_id = $1
       AND document_type = 'person'
       AND LOWER(properties->>'email') = LOWER($2)
       AND archived_at IS NULL
     ORDER BY
       CASE WHEN properties->>'pending' = 'true' THEN 1 ELSE 0 END,
       created_at DESC
     LIMIT 1`,
    [invite.workspace_id, email]
  );

  let personDocId: string;

  if (existingPersonDoc.rows[0]) {
    // Update existing person doc (reuse orphaned or pending doc)
    personDocId = existingPersonDoc.rows[0].id;
    await pool.query(
      `UPDATE documents
       SET title = $1,
           properties = jsonb_set(
             jsonb_set(
               properties - 'pending' - 'invite_id',
               '{user_id}', $2::jsonb
             ),
             '{email}', $3::jsonb
           )
       WHERE id = $4`,
      [user.name, JSON.stringify(user.id), JSON.stringify(email), personDocId]
    );
  } else {
    // Create new person doc
    const newDoc = await pool.query<DocumentIdRow>(
      `INSERT INTO documents (workspace_id, document_type, title, properties)
       VALUES ($1, 'person', $2, $3)
       RETURNING id`,
      [invite.workspace_id, user.name, JSON.stringify({ user_id: user.id, email })]
    );
    const insertedDoc = newDoc.rows[0];
    if (!insertedDoc) {
      throw new Error('Failed to create person document for invite acceptance');
    }
    personDocId = insertedDoc.id;
  }

  // Mark invite as used
  await pool.query(
    'UPDATE workspace_invites SET used_at = NOW() WHERE id = $1',
    [invite.id]
  );

  // Defensive cleanup: Archive any other pending person docs for this email
  await pool.query(
    `UPDATE documents SET archived_at = NOW()
     WHERE workspace_id = $1
       AND document_type = 'person'
       AND properties->>'pending' = 'true'
       AND archived_at IS NULL
       AND LOWER(properties->>'email') = LOWER($2)
       AND id != $3`,
    [invite.workspace_id, email, personDocId]
  );

  return { personDocId, isNewMembership };
}
