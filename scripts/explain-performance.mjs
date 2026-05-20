#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
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
const workspaceName = process.env.EXPLAIN_WORKSPACE || 'Ship Workspace';
const email = process.env.EXPLAIN_EMAIL || 'dev@ship.local';
const outputPath = resolve(
  rootDir,
  process.env.EXPLAIN_OUTPUT || `test-results/perf/explain-performance-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
);

const { Pool } = pg;
const pool = new Pool({ connectionString: databaseUrl });

async function context(client) {
  const result = await client.query(
    `SELECT w.id AS workspace_id, u.id AS user_id,
            EXISTS (
              SELECT 1 FROM workspace_memberships wm
              WHERE wm.workspace_id = w.id AND wm.user_id = u.id AND wm.role = 'admin'
            ) AS is_admin
     FROM workspaces w
     JOIN users u ON LOWER(u.email) = LOWER($2)
     WHERE w.name = $1
     ORDER BY w.created_at ASC
     LIMIT 1`,
    [workspaceName, email]
  );
  if (!result.rows[0]) {
    throw new Error(`Could not find workspace "${workspaceName}" and user "${email}". Run pnpm db:seed first.`);
  }
  return result.rows[0];
}

async function explain(client, name, sql, params) {
  const startedAt = performance.now();
  const result = await client.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql}`, params);
  const elapsedMs = performance.now() - startedAt;
  const plan = result.rows[0]['QUERY PLAN'][0];

  return {
    name,
    elapsed_ms: Math.round(elapsedMs),
    planning_ms: plan['Planning Time'],
    execution_ms: plan['Execution Time'],
    plan,
  };
}

function queryCatalog({ workspace_id: workspaceId, user_id: userId, is_admin: isAdmin }) {
  const visibilitySql = '(d.visibility = \'workspace\' OR d.created_by = $2 OR $3 = TRUE)';

  return [
    {
      name: 'documents_list_wiki',
      sql: `SELECT id, workspace_id, document_type, title, parent_id, position,
                   ticket_number, properties, created_at, updated_at, created_by, visibility
            FROM documents d
            WHERE workspace_id = $1
              AND ${visibilitySql}
              AND archived_at IS NULL
              AND deleted_at IS NULL
              AND document_type = 'wiki'
            ORDER BY position ASC, created_at DESC`,
      params: [workspaceId, userId, isAdmin],
    },
    {
      name: 'issues_list',
      sql: `SELECT d.id, d.title, d.properties, d.ticket_number,
                   d.content, d.created_at, d.updated_at, d.created_by,
                   d.started_at, d.completed_at, d.cancelled_at, d.reopened_at,
                   d.converted_from_id, u.name AS assignee_name,
                   CASE WHEN person_doc.archived_at IS NOT NULL THEN true ELSE false END AS assignee_archived
            FROM documents d
            LEFT JOIN users u ON (d.properties->>'assignee_id')::uuid = u.id
            LEFT JOIN documents person_doc ON person_doc.workspace_id = d.workspace_id
              AND person_doc.document_type = 'person'
              AND person_doc.properties->>'user_id' = d.properties->>'assignee_id'
            WHERE d.workspace_id = $1
              AND d.document_type = 'issue'
              AND ${visibilitySql}
              AND d.archived_at IS NULL
              AND d.deleted_at IS NULL
            ORDER BY d.ticket_number DESC NULLS LAST, d.created_at DESC`,
      params: [workspaceId, userId, isAdmin],
    },
    {
      name: 'projects_list_counts',
      sql: `SELECT d.id, d.title, d.content, d.properties, d.created_at, d.updated_at,
                   prog.id AS program_id, prog.title AS program_title,
                   (SELECT COUNT(*) FROM documents s
                    JOIN document_associations da ON da.document_id = s.id
                      AND da.related_id = d.id
                      AND da.relationship_type = 'project'
                    WHERE s.document_type = 'sprint'
                      AND s.archived_at IS NULL
                      AND s.deleted_at IS NULL) AS sprint_count,
                   (SELECT COUNT(*) FROM documents i
                    JOIN document_associations da ON da.document_id = i.id
                      AND da.related_id = d.id
                      AND da.relationship_type = 'project'
                    WHERE i.document_type = 'issue'
                      AND i.archived_at IS NULL
                      AND i.deleted_at IS NULL) AS issue_count
            FROM documents d
            LEFT JOIN document_associations prog_da ON prog_da.document_id = d.id
              AND prog_da.relationship_type = 'program'
            LEFT JOIN documents prog ON prog.id = prog_da.related_id
            WHERE d.workspace_id = $1
              AND d.document_type = 'project'
              AND ${visibilitySql}
              AND d.archived_at IS NULL
              AND d.deleted_at IS NULL
            ORDER BY d.created_at DESC`,
      params: [workspaceId, userId, isAdmin],
    },
    {
      name: 'audit_logs_tagged_recent',
      sql: `SELECT id, workspace_id, actor_user_id, action, resource_type, details, created_at
            FROM audit_logs
            WHERE workspace_id = $1
              AND details->>'audit_load_tag' = $2
            ORDER BY created_at DESC
            LIMIT 100`,
      params: [workspaceId, process.env.AUDIT_LOAD_TAG || 'audit_load'],
    },
    {
      name: 'document_association_issue_project',
      sql: `SELECT d.id, d.title, da.related_id, related.title AS related_title
            FROM documents d
            JOIN document_associations da ON da.document_id = d.id
              AND da.relationship_type = 'project'
            JOIN documents related ON related.id = da.related_id
            WHERE d.workspace_id = $1
              AND d.document_type = 'issue'
              AND d.archived_at IS NULL
              AND d.deleted_at IS NULL
            ORDER BY d.created_at DESC
            LIMIT 250`,
      params: [workspaceId],
    },
  ];
}

const client = await pool.connect();
try {
  const ctx = await context(client);
  const results = [];
  for (const item of queryCatalog(ctx)) {
    results.push(await explain(client, item.name, item.sql, item.params));
  }

  const report = {
    generated_at: new Date().toISOString(),
    database: new URL(databaseUrl).pathname.slice(1),
    workspace: workspaceName,
    user: email,
    results,
  };

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`EXPLAIN report written to ${outputPath}`);
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
