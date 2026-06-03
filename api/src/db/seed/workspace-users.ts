import bcrypt from 'bcryptjs';
import { PASSWORD_BCRYPT_ROUNDS } from '@ship/shared';
import { IdRow } from '../../test/pg-result.js';
import { requireFirstRow } from '../../utils/query-rows.js';
import { seedAt, SeedContext, SeedUserRow } from './seed-helpers.js';

const TEAM_MEMBERS = [
  { email: 'dev@ship.local', name: 'Dev User' },
  { email: 'alice.chen@ship.local', name: 'Alice Chen' },
  { email: 'bob.martinez@ship.local', name: 'Bob Martinez' },
  { email: 'carol.williams@ship.local', name: 'Carol Williams' },
  { email: 'david.kim@ship.local', name: 'David Kim' },
  { email: 'emma.johnson@ship.local', name: 'Emma Johnson' },
  { email: 'frank.garcia@ship.local', name: 'Frank Garcia' },
  { email: 'grace.lee@ship.local', name: 'Grace Lee' },
  { email: 'henry.patel@ship.local', name: 'Henry Patel' },
  { email: 'iris.nguyen@ship.local', name: 'Iris Nguyen' },
  { email: 'jack.brown@ship.local', name: 'Jack Brown' },
];

const REPORTING_HIERARCHY: Record<string, string[]> = {
  'dev@ship.local': [], // Root — no manager
  'alice.chen@ship.local': ['dev@ship.local'],
  'bob.martinez@ship.local': ['dev@ship.local'],
  'carol.williams@ship.local': ['dev@ship.local'],
  'david.kim@ship.local': ['alice.chen@ship.local'],
  'emma.johnson@ship.local': ['alice.chen@ship.local'],
  'frank.garcia@ship.local': ['bob.martinez@ship.local'],
  'grace.lee@ship.local': ['bob.martinez@ship.local'],
  'henry.patel@ship.local': ['carol.williams@ship.local'],
  'iris.nguyen@ship.local': ['carol.williams@ship.local'],
  'jack.brown@ship.local': ['carol.williams@ship.local'],
};

export async function seedWorkspaceUsers(ctx: SeedContext): Promise<void> {
  const { pool } = ctx;

  // Check if workspace exists
  const existingWorkspace = await pool.query<IdRow>(
    'SELECT id FROM workspaces WHERE name = $1',
    ['Ship Workspace']
  );

  if (existingWorkspace.rows[0]) {
    ctx.workspaceId = requireFirstRow(existingWorkspace.rows).id;
    console.log('ℹ️  Workspace already exists');
  } else {
    // Create workspace with sprint_start_date ~3 months ago, aligned to Monday.
    // Weeks must start on Monday to match production and ensure the heatmap
    // shows correct "due" (yellow) windows for plans (Sat-Mon) and retros (Thu-Fri).
    const threeMonthsAgo = new Date();
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
    // Roll back to the nearest Monday (day 1)
    const dayOfWeek = threeMonthsAgo.getDay(); // 0=Sun, 1=Mon, ...
    const daysToSubtract = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    threeMonthsAgo.setDate(threeMonthsAgo.getDate() - daysToSubtract);
    const workspaceResult = await pool.query<IdRow>(
      `INSERT INTO workspaces (name, sprint_start_date)
       VALUES ($1, $2)
       RETURNING id`,
      ['Ship Workspace', threeMonthsAgo.toISOString().split('T')[0]]
    );
    ctx.workspaceId = requireFirstRow(workspaceResult.rows).id;
    console.log('✅ Workspace created');
  }

  const passwordHash = await bcrypt.hash('admin123', PASSWORD_BCRYPT_ROUNDS);
  let usersCreated = 0;

  for (const member of TEAM_MEMBERS) {
    const existingUser = await pool.query<IdRow>(
      'SELECT id FROM users WHERE LOWER(email) = LOWER($1)',
      [member.email]
    );

    if (!existingUser.rows[0]) {
      await pool.query(
        `INSERT INTO users (email, password_hash, name, last_workspace_id)
         VALUES ($1, $2, $3, $4)`,
        [member.email, passwordHash, member.name, ctx.workspaceId]
      );
      usersCreated++;
    }
  }

  if (usersCreated > 0) {
    console.log(`✅ Created ${usersCreated} users (all use password: admin123)`);
  } else {
    console.log('ℹ️  All users already exist');
  }

  // Set dev user as super-admin and set their last workspace
  await pool.query(
    `UPDATE users SET is_super_admin = true, last_workspace_id = $1 WHERE email = 'dev@ship.local'`,
    [ctx.workspaceId]
  );
  console.log('✅ Set dev@ship.local as super-admin');

  // Create workspace memberships and Person documents for all users
  // Note: These are independent - no coupling via person_document_id
  let membershipsCreated = 0;
  let personDocsCreated = 0;
  const allUsersForMembership = await pool.query<{ id: string; email: string; name: string }>(
    'SELECT id, email, name FROM users'
  );

  for (const user of allUsersForMembership.rows) {
    // Check for existing membership
    const existingMembership = await pool.query<IdRow>(
      'SELECT id FROM workspace_memberships WHERE workspace_id = $1 AND user_id = $2',
      [ctx.workspaceId, user.id]
    );

    if (!existingMembership.rows[0]) {
      // Make dev user an admin, others are members
      const role = user.email === 'dev@ship.local' ? 'admin' : 'member';
      await pool.query(
        `INSERT INTO workspace_memberships (workspace_id, user_id, role)
         VALUES ($1, $2, $3)`,
        [ctx.workspaceId, user.id, role]
      );
      membershipsCreated++;
    }

    // Check for existing person document (via properties.user_id)
    const existingPersonDoc = await pool.query<IdRow>(
      `SELECT id FROM documents
       WHERE workspace_id = $1 AND document_type = 'person' AND properties->>'user_id' = $2`,
      [ctx.workspaceId, user.id]
    );

    if (!existingPersonDoc.rows[0]) {
      // Create Person document with properties.user_id
      await pool.query(
        `INSERT INTO documents (workspace_id, document_type, title, properties, created_by)
         VALUES ($1, 'person', $2, $3, $4)`,
        [ctx.workspaceId, user.name, JSON.stringify({ user_id: user.id, email: user.email }), user.id]
      );
      personDocsCreated++;
    }
  }

  if (membershipsCreated > 0) {
    console.log(`✅ Created ${membershipsCreated} workspace memberships`);
  } else {
    console.log('ℹ️  All workspace memberships already exist');
  }

  if (personDocsCreated > 0) {
    console.log(`✅ Created ${personDocsCreated} Person documents`);
  }

  // Set up reports_to hierarchy: Dev User → 3 managers → remaining ICs
  // Build email → user_id map
  const emailToUserId = new Map<string, string>();
  for (const user of allUsersForMembership.rows) {
    emailToUserId.set(user.email, user.id);
  }

  // Set reports_to on person documents
  let reportsToSet = 0;
  for (const [email, managers] of Object.entries(REPORTING_HIERARCHY)) {
    if (managers.length === 0) continue; // Root has no manager
    const managerEmail = seedAt(managers[0], 'reportingHierarchy manager');
    const managerId = emailToUserId.get(managerEmail);
    const userId = emailToUserId.get(email);
    if (managerId && userId) {
      await pool.query(
        `UPDATE documents SET properties = properties || jsonb_build_object('reports_to', $1::text)
         WHERE workspace_id = $2 AND document_type = 'person' AND properties->>'user_id' = $3`,
        [managerId, ctx.workspaceId, userId]
      );
      reportsToSet++;
    }
  }
  if (reportsToSet > 0) {
    console.log(`✅ Set reports_to for ${reportsToSet} people (3-level hierarchy)`);
  }

  // Get all user IDs for assignment (join through workspace_memberships)
  // Also get person document IDs for team allocation
  const allUsersResult = await pool.query<SeedUserRow>(
    `SELECT u.id, u.name, d.id as person_doc_id FROM users u
     JOIN workspace_memberships wm ON wm.user_id = u.id
     LEFT JOIN documents d ON d.workspace_id = wm.workspace_id
       AND d.document_type = 'person' AND d.properties->>'user_id' = u.id::text
     WHERE wm.workspace_id = $1`,
    [ctx.workspaceId]
  );
  ctx.allUsers = allUsersResult.rows;
}
