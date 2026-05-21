#!/usr/bin/env node
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const requireFromApi = createRequire(resolve(rootDir, 'api/package.json'));
const pg = requireFromApi('pg');
const { config } = requireFromApi('dotenv');

config({ path: resolve(rootDir, 'api/.env.local') });
config({ path: resolve(rootDir, 'api/.env') });

const databaseUrl = process.env.DATABASE_URL || 'postgresql://localhost/ship_dev';
const tag = process.env.AUDIT_LOAD_TAG || 'audit_load';
const workspaceName = process.env.AUDIT_LOAD_WORKSPACE || 'Ship Workspace';
const documentCount = positiveInt(process.env.AUDIT_LOAD_DOCUMENTS, 1000);
const auditLogCount = positiveInt(process.env.AUDIT_LOAD_AUDIT_LOGS, 10000);
const userCount = positiveInt(process.env.AUDIT_LOAD_USERS, 20);
const sprintCount = positiveInt(process.env.AUDIT_LOAD_SPRINTS, 10);
const batchSize = positiveInt(process.env.AUDIT_LOAD_BATCH_SIZE, 500);
const cleanup = process.argv.includes('--cleanup') || process.env.AUDIT_LOAD_CLEANUP === '1';
const searchTerms = {
  rare: process.env.AUDIT_LOAD_SEARCH_RARE_TERM || 'auditloadrareterm',
  medium: process.env.AUDIT_LOAD_SEARCH_MEDIUM_TERM || 'auditloadmediumterm',
  common: process.env.AUDIT_LOAD_SEARCH_COMMON_TERM || 'auditloadcommonterm',
  no_match: process.env.AUDIT_LOAD_SEARCH_NO_MATCH_TERM || 'auditloadnomatchterm',
};

const { Pool } = pg;
const pool = new Pool({ connectionString: databaseUrl });

function positiveInt(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function searchTermsForIndex(index) {
  const terms = [searchTerms.common];
  if (index % 10 === 0) terms.push(searchTerms.medium);
  if (index === 1) terms.push(searchTerms.rare);
  return terms;
}

function makeContent(index) {
  const terms = searchTermsForIndex(index);
  return {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [{ type: 'text', text: `Audit load measurement document ${index} ${terms.join(' ')}` }],
      },
    ],
  };
}

async function requireWorkspace(client) {
  const result = await client.query(
    'SELECT id FROM workspaces WHERE name = $1 ORDER BY created_at ASC LIMIT 1',
    [workspaceName]
  );
  if (!result.rows[0]) {
    throw new Error(`Workspace "${workspaceName}" not found. Run pnpm db:seed against ship_dev first.`);
  }
  return result.rows[0].id;
}

async function requireActor(client, workspaceId) {
  const result = await client.query(
    `SELECT u.id
     FROM users u
     JOIN workspace_memberships wm ON wm.user_id = u.id
     WHERE wm.workspace_id = $1
     ORDER BY (u.email = 'dev@ship.local') DESC, u.created_at ASC
     LIMIT 1`,
    [workspaceId]
  );
  if (!result.rows[0]) {
    throw new Error(`No workspace member found for workspace ${workspaceId}. Run pnpm db:seed first.`);
  }
  return result.rows[0].id;
}

async function cleanupTaggedRows(client, workspaceId) {
  const auditLogs = await client.query(
    "DELETE FROM audit_logs WHERE workspace_id = $1 AND details->>'audit_load_tag' = $2",
    [workspaceId, tag]
  );
  const documents = await client.query(
    "DELETE FROM documents WHERE workspace_id = $1 AND properties->>'audit_load_tag' = $2",
    [workspaceId, tag]
  );
  const memberships = await client.query(
    `DELETE FROM workspace_memberships wm
     USING users u
     WHERE wm.workspace_id = $1
       AND wm.user_id = u.id
       AND u.email LIKE 'audit-load-%@ship.local'`,
    [workspaceId]
  );
  const users = await client.query(
    `DELETE FROM users u
     WHERE u.email LIKE 'audit-load-%@ship.local'
       AND NOT EXISTS (
         SELECT 1 FROM workspace_memberships wm
         WHERE wm.user_id = u.id
       )`
  );
  return {
    deleted_documents: documents.rowCount,
    deleted_audit_logs: auditLogs.rowCount,
    deleted_memberships: memberships.rowCount,
    deleted_users: users.rowCount,
  };
}

async function seedUsers(client, workspaceId, actorUserId) {
  const existing = await client.query(
    `SELECT COUNT(*)::int AS count
     FROM workspace_memberships
     WHERE workspace_id = $1`,
    [workspaceId]
  );
  const missing = Math.max(0, userCount - existing.rows[0].count);
  const created = [];

  for (let index = 1; created.length < missing; index++) {
    const sequence = String(index).padStart(3, '0');
    const email = `audit-load-${sequence}@ship.local`;
    const name = `Audit Load User ${sequence}`;
    const existingMember = await client.query(
      `SELECT 1
       FROM users u
       JOIN workspace_memberships wm ON wm.user_id = u.id
       WHERE wm.workspace_id = $1
         AND LOWER(u.email) = LOWER($2)
       LIMIT 1`,
      [workspaceId, email]
    );
    if (existingMember.rows[0]) {
      continue;
    }

    const user = await client.query(
      `INSERT INTO users (email, name, last_workspace_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (email) DO UPDATE
       SET name = EXCLUDED.name,
           last_workspace_id = EXCLUDED.last_workspace_id
       RETURNING id`,
      [email, name, workspaceId]
    );
    const userId = user.rows[0].id;

    await client.query(
      `INSERT INTO workspace_memberships (workspace_id, user_id, role)
       VALUES ($1, $2, 'member')
       ON CONFLICT (workspace_id, user_id) DO NOTHING`,
      [workspaceId, userId]
    );

    await client.query(
      `INSERT INTO documents (workspace_id, document_type, title, properties, created_by)
       SELECT $1, 'person', $2, $3::jsonb, $4
       WHERE NOT EXISTS (
         SELECT 1 FROM documents
         WHERE workspace_id = $1
           AND document_type = 'person'
           AND properties->>'user_id' = $5
       )`,
      [
        workspaceId,
        name,
        JSON.stringify({ user_id: userId, email, audit_load_tag: tag, audit_load_sequence: index }),
        actorUserId,
        userId,
      ]
    );

    created.push(userId);
  }

  const total = await client.query(
    `SELECT COUNT(*)::int AS count
     FROM workspace_memberships
     WHERE workspace_id = $1`,
    [workspaceId]
  );

  return { inserted: created.length, total: total.rows[0].count };
}

async function seedSprints(client, workspaceId, actorUserId) {
  const existing = await client.query(
    `SELECT COUNT(*)::int AS count
     FROM documents
     WHERE workspace_id = $1
       AND document_type = 'sprint'
       AND archived_at IS NULL
       AND deleted_at IS NULL`,
    [workspaceId]
  );
  const missing = Math.max(0, sprintCount - existing.rows[0].count);

  const maxSprint = await client.query(
    `SELECT COALESCE(MAX((properties->>'sprint_number')::int), 0) AS max_sprint
     FROM documents
     WHERE workspace_id = $1
       AND document_type = 'sprint'
       AND properties ? 'sprint_number'`,
    [workspaceId]
  );

  let inserted = 0;
  const startNumber = Number(maxSprint.rows[0].max_sprint) + 1;
  for (let offset = 0; offset < missing; offset++) {
    const sprintNumber = startNumber + offset;
    await client.query(
      `INSERT INTO documents (workspace_id, document_type, title, properties, created_by)
       VALUES ($1, 'sprint', $2, $3::jsonb, $4)`,
      [
        workspaceId,
        `Audit Load Week ${sprintNumber}`,
        JSON.stringify({
          audit_load_tag: tag,
          audit_load_sequence: sprintNumber,
          sprint_number: sprintNumber,
          owner_id: actorUserId,
          plan: 'Synthetic load week for performance evidence only.',
          success_criteria: 'Used only to meet audit-scale measurement minimums.',
        }),
        actorUserId,
      ]
    );
    inserted++;
  }

  const total = await client.query(
    `SELECT COUNT(*)::int AS count
     FROM documents
     WHERE workspace_id = $1
       AND document_type = 'sprint'
       AND archived_at IS NULL
       AND deleted_at IS NULL`,
    [workspaceId]
  );

  return { inserted, total: total.rows[0].count };
}

async function seedDocuments(client, workspaceId, actorUserId) {
  let inserted = 0;

  for (let start = 1; start <= documentCount; start += batchSize) {
    const end = Math.min(documentCount, start + batchSize - 1);
    const values = [];
    const params = [workspaceId, actorUserId, tag];

    for (let index = start; index <= end; index++) {
      const documentSearchTerms = searchTermsForIndex(index);
      params.push(
        `Audit Load ${String(index).padStart(6, '0')}`,
        JSON.stringify(makeContent(index)),
        JSON.stringify({
          audit_load_tag: tag,
          audit_load_sequence: index,
          audit_load_search_terms: documentSearchTerms,
          state: ['todo', 'in_progress', 'done', 'cancelled'][index % 4],
          priority: ['low', 'medium', 'high'][index % 3],
          estimate: (index % 8) + 1,
        })
      );
      const offset = 3 + (index - start) * 3;
      values.push(`($1, 'issue', $${offset + 1}, $${offset + 2}::jsonb, $${offset + 3}::jsonb, $2)`);
    }

    const result = await client.query(
      `WITH candidate(workspace_id, document_type, title, content, properties, created_by) AS (
         VALUES ${values.join(',\n')}
       )
       INSERT INTO documents (workspace_id, document_type, title, content, properties, created_by)
       SELECT workspace_id::uuid, document_type::document_type, title, content, properties, created_by::uuid
       FROM candidate c
       WHERE NOT EXISTS (
         SELECT 1 FROM documents d
         WHERE d.workspace_id = c.workspace_id::uuid
           AND d.properties->>'audit_load_tag' = $3
           AND d.properties->>'audit_load_sequence' = c.properties->>'audit_load_sequence'
       )`,
      params
    );
    inserted += result.rowCount;
  }

  const total = await client.query(
    "SELECT COUNT(*)::int AS count FROM documents WHERE workspace_id = $1 AND properties->>'audit_load_tag' = $2",
    [workspaceId, tag]
  );

  return { inserted, total: total.rows[0].count };
}

async function seedAuditLogs(client, workspaceId, actorUserId) {
  let inserted = 0;

  for (let start = 1; start <= auditLogCount; start += batchSize) {
    const end = Math.min(auditLogCount, start + batchSize - 1);
    const values = [];
    const params = [workspaceId, actorUserId, tag];

    for (let index = start; index <= end; index++) {
      params.push(
        ['document.created', 'document.updated', 'issue.transitioned', 'workspace.viewed'][index % 4],
        JSON.stringify({
          audit_load_tag: tag,
          audit_load_sequence: index,
          measurement_only: true,
          synthetic_latency_bucket: index % 10,
        })
      );
      const offset = 3 + (index - start) * 2;
      values.push(`($1, $2, $${offset + 1}, 'document', $${offset + 2}::jsonb)`);
    }

    const result = await client.query(
      `WITH candidate(workspace_id, actor_user_id, action, resource_type, details) AS (
         VALUES ${values.join(',\n')}
       )
       INSERT INTO audit_logs (workspace_id, actor_user_id, action, resource_type, details)
       SELECT workspace_id::uuid, actor_user_id::uuid, action, resource_type, details
       FROM candidate c
       WHERE NOT EXISTS (
         SELECT 1 FROM audit_logs al
         WHERE al.workspace_id = c.workspace_id::uuid
           AND al.details->>'audit_load_tag' = $3
           AND al.details->>'audit_load_sequence' = c.details->>'audit_load_sequence'
       )`,
      params
    );
    inserted += result.rowCount;
  }

  const total = await client.query(
    "SELECT COUNT(*)::int AS count FROM audit_logs WHERE workspace_id = $1 AND details->>'audit_load_tag' = $2",
    [workspaceId, tag]
  );

  return { inserted, total: total.rows[0].count };
}

const client = await pool.connect();
try {
  await client.query('BEGIN');
  const workspaceId = await requireWorkspace(client);
  const actorUserId = await requireActor(client, workspaceId);

  if (cleanup) {
    const result = await cleanupTaggedRows(client, workspaceId);
    await client.query('COMMIT');
    console.log(JSON.stringify({ tag, workspace: workspaceName, cleanup: true, ...result }, null, 2));
  } else {
    const users = await seedUsers(client, workspaceId, actorUserId);
    const sprints = await seedSprints(client, workspaceId, actorUserId);
    const documents = await seedDocuments(client, workspaceId, actorUserId);
    const auditLogs = await seedAuditLogs(client, workspaceId, actorUserId);
    await client.query('COMMIT');
    console.log(JSON.stringify({ tag, workspace: workspaceName, cleanup: false, search_terms: searchTerms, users, sprints, documents, audit_logs: auditLogs }, null, 2));
  }
} catch (error) {
  await client.query('ROLLBACK');
  console.error(error);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
