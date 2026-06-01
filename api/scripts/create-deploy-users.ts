/**
 * Create or update deploy test users (Render / production DB).
 *
 * Usage:
 *   DATABASE_URL="postgresql://..." npx tsx api/scripts/create-deploy-users.ts
 */

import bcrypt from 'bcryptjs';
import { PASSWORD_BCRYPT_ROUNDS } from '@ship/shared';
import pg from 'pg';

const { Pool } = pg;

type DeployUserSpec = {
  email: string;
  password: string;
  name: string;
  isSuperAdmin: boolean;
  workspaceRole: 'admin' | 'member';
};

const DEPLOY_USERS: DeployUserSpec[] = [
  {
    email: 'adminx@ship.local',
    password: 'adminx',
    name: 'Admin X',
    isSuperAdmin: true,
    workspaceRole: 'admin',
  },
  {
    email: 'userx@ship.local',
    password: 'userx',
    name: 'User X',
    isSuperAdmin: false,
    workspaceRole: 'member',
  },
];

async function ensurePersonDocument(
  pool: pg.Pool,
  workspaceId: string,
  userId: string,
  name: string,
  email: string
): Promise<void> {
  const existing = await pool.query<{ id: string }>(
    `SELECT id FROM documents
     WHERE workspace_id = $1
       AND document_type = 'person'
       AND properties->>'user_id' = $2`,
    [workspaceId, userId]
  );

  if (existing.rows[0]) {
    return;
  }

  await pool.query(
    `INSERT INTO documents (workspace_id, document_type, title, properties, created_by)
     VALUES ($1, 'person', $2, $3, $4)`,
    [workspaceId, name, JSON.stringify({ user_id: userId, email }), userId]
  );
}

async function upsertDeployUser(pool: pg.Pool, workspaceId: string, spec: DeployUserSpec) {
  const passwordHash = await bcrypt.hash(spec.password, PASSWORD_BCRYPT_ROUNDS);

  const existing = await pool.query<{ id: string }>(
    'SELECT id FROM users WHERE LOWER(email) = LOWER($1)',
    [spec.email]
  );

  let userId: string;

  if (existing.rows[0]) {
    userId = existing.rows[0].id;
    await pool.query(
      `UPDATE users
       SET password_hash = $1,
           name = $2,
           is_super_admin = $3,
           last_workspace_id = $4
       WHERE id = $5`,
      [passwordHash, spec.name, spec.isSuperAdmin, workspaceId, userId]
    );
    console.log(`Updated user ${spec.email}`);
  } else {
    const created = await pool.query<{ id: string }>(
      `INSERT INTO users (email, password_hash, name, is_super_admin, last_workspace_id)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [spec.email, passwordHash, spec.name, spec.isSuperAdmin, workspaceId]
    );
    const createdRow = created.rows[0];
    if (!createdRow) {
      throw new Error(`Failed to create user ${spec.email}`);
    }
    userId = createdRow.id;
    console.log(`Created user ${spec.email}`);
  }

  const membership = await pool.query<{ id: string }>(
    'SELECT id FROM workspace_memberships WHERE workspace_id = $1 AND user_id = $2',
    [workspaceId, userId]
  );

  if (membership.rows[0]) {
    await pool.query(
      'UPDATE workspace_memberships SET role = $1 WHERE id = $2',
      [spec.workspaceRole, membership.rows[0].id]
    );
  } else {
    await pool.query(
      `INSERT INTO workspace_memberships (workspace_id, user_id, role)
       VALUES ($1, $2, $3)`,
      [workspaceId, userId, spec.workspaceRole]
    );
  }

  await ensurePersonDocument(pool, workspaceId, userId, spec.name, spec.email);

  const verify = await pool.query<{
    email: string;
    is_super_admin: boolean;
    role: string | null;
  }>(
    `SELECT u.email, u.is_super_admin, wm.role
     FROM users u
     LEFT JOIN workspace_memberships wm
       ON wm.user_id = u.id AND wm.workspace_id = $2
     WHERE u.id = $1`,
    [userId, workspaceId]
  );

  console.log('  ', verify.rows[0]);
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('ERROR: DATABASE_URL is required');
    process.exit(1);
  }

  const pool = new Pool({
    connectionString: databaseUrl,
    ssl: databaseUrl.includes('render.com') ? { rejectUnauthorized: false } : undefined,
  });

  try {
    const workspaceResult = await pool.query<{ id: string; name: string }>(
      'SELECT id, name FROM workspaces ORDER BY created_at ASC LIMIT 1'
    );

    const workspace = workspaceResult.rows[0];
    if (!workspace) {
      console.error('ERROR: No workspace found in database');
      process.exit(1);
    }

    console.log(`Using workspace: ${workspace.name} (${workspace.id})`);

    for (const spec of DEPLOY_USERS) {
      await upsertDeployUser(pool, workspace.id, spec);
    }

    console.log('\nDone. Credentials:');
    for (const spec of DEPLOY_USERS) {
      console.log(`  ${spec.email} / ${spec.password} (${spec.isSuperAdmin ? 'super-admin' : 'workspace user'})`);
    }
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
