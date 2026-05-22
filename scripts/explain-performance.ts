#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  computeCurrentSprintNumber,
  formatUtcDateIso,
  normalizeWorkspaceStartDate,
  utcToday,
} from '@ship/shared';
import {
  buildBootstrapExplainCatalog,
  oldFanoutQueries,
  type BootstrapExplainQuery,
} from '../api/src/sql/bootstrap-queries.js';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const requireFromApi = createRequire(resolve(rootDir, 'api/package.json'));
const pg = requireFromApi('pg');
const { config } = requireFromApi('dotenv');

config({ path: resolve(rootDir, 'api/.env.local') });
config({ path: resolve(rootDir, 'api/.env') });

const databaseUrl = process.env.DATABASE_URL || 'postgresql://localhost/ship_dev';
const workspaceName = process.env.EXPLAIN_WORKSPACE || 'Ship Workspace';
const email = process.env.EXPLAIN_EMAIL || 'dev@ship.local';
const searchTerms = {
  rare: process.env.EXPLAIN_SEARCH_RARE_TERM || process.env.AUDIT_LOAD_SEARCH_RARE_TERM || 'auditloadrareterm',
  medium: process.env.EXPLAIN_SEARCH_MEDIUM_TERM || process.env.AUDIT_LOAD_SEARCH_MEDIUM_TERM || 'auditloadmediumterm',
  common: process.env.EXPLAIN_SEARCH_COMMON_TERM || process.env.AUDIT_LOAD_SEARCH_COMMON_TERM || 'auditloadcommonterm',
  no_match: process.env.EXPLAIN_SEARCH_NO_MATCH_TERM || process.env.AUDIT_LOAD_SEARCH_NO_MATCH_TERM || 'auditloadnomatchterm',
};
const outputPath = resolve(
  rootDir,
  process.env.EXPLAIN_OUTPUT || `test-results/perf/explain-performance-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
);

const { Pool } = pg;
const pool = new Pool({ connectionString: databaseUrl });

interface ExplainContext {
  workspace_id: string;
  user_id: string;
  is_admin: boolean;
}

async function loadContext(client: { query: typeof pool.query }): Promise<ExplainContext> {
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
  return result.rows[0] as ExplainContext;
}

async function explainQuery(
  client: { query: typeof pool.query },
  name: string,
  sql: string,
  params: unknown[]
) {
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

async function loadSprintContext(client: { query: typeof pool.query }, workspaceId: string) {
  const result = await client.query('SELECT sprint_start_date FROM workspaces WHERE id = $1', [workspaceId]);
  const rawStartDate = result.rows[0]?.sprint_start_date;
  const workspaceStartDate = normalizeWorkspaceStartDate(rawStartDate);
  const today = utcToday();

  return {
    currentSprintNumber: computeCurrentSprintNumber(workspaceStartDate),
    todayIso: today.toISOString(),
    todayStr: formatUtcDateIso(today),
  };
}

function queryCatalog(ctx: ExplainContext) {
  const { workspace_id: workspaceId, user_id: userId, is_admin: isAdmin } = ctx;
  const visibilitySql = '(d.visibility = \'workspace\' OR d.created_by = $2 OR $3 = TRUE)';
  const contentSearchSql = `WITH search_query AS (
                              SELECT websearch_to_tsquery('english', $4) AS query
                            ),
                            visible_matches AS (
                              SELECT d.id, d.title, d.document_type, d.visibility, d.ticket_number, d.updated_at,
                                     ts_rank_cd(i.search_vector, search_query.query) AS rank,
                                     COALESCE(
                                       NULLIF(ts_headline(
                                         'english',
                                         i.content_text,
                                         search_query.query,
                                         'StartSel=<mark>, StopSel=</mark>, MaxWords=24, MinWords=8, ShortWord=3'
                                       ), ''),
                                       ts_headline(
                                         'english',
                                         i.title,
                                         search_query.query,
                                         'StartSel=<mark>, StopSel=</mark>, MaxWords=16, MinWords=4, ShortWord=3'
                                       )
                                     ) AS snippet
                              FROM document_search_index i
                              JOIN documents d ON d.id = i.document_id
                              CROSS JOIN search_query
                              WHERE d.workspace_id = $1
                                AND ${visibilitySql}
                                AND d.archived_at IS NULL
                                AND d.deleted_at IS NULL
                                AND i.search_vector @@ search_query.query
                            ),
                            counted_matches AS (
                              SELECT *, COUNT(*) OVER()::int AS total
                              FROM visible_matches
                            )
                            SELECT id, title, document_type, visibility, ticket_number, updated_at, rank, snippet, total
                            FROM counted_matches
                            ORDER BY rank DESC, updated_at DESC
                            LIMIT $5 OFFSET $6`;

  return [
    ...Object.entries(searchTerms).map(([bucket, term]) => ({
      name: `content_search_${bucket}`,
      sql: contentSearchSql,
      params: [workspaceId, userId, isAdmin, term, 10, 0],
    })),
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

async function explainEvidenceGroup(
  client: { query: typeof pool.query },
  queries: BootstrapExplainQuery[]
) {
  const results = [];
  for (const item of queries) {
    results.push({
      endpoint: item.endpoint,
      source: item.source,
      sql: item.sql,
      params: item.params,
      ...(await explainQuery(client, item.name, item.sql, item.params)),
    });
  }
  return results;
}

async function main(): Promise<void> {
  const client = await pool.connect();
  try {
    const ctx = await loadContext(client);
    const sprintContext = await loadSprintContext(client, ctx.workspace_id);
    const results = [];
    for (const item of queryCatalog(ctx)) {
      results.push(await explainQuery(client, item.name, item.sql, item.params));
    }
    const bootstrapEvidence = buildBootstrapExplainCatalog({
      workspaceId: ctx.workspace_id,
      userId: ctx.user_id,
      isAdmin: ctx.is_admin,
      ...sprintContext,
    });

    const report = {
      generated_at: new Date().toISOString(),
      database: new URL(databaseUrl).pathname.slice(1),
      workspace: workspaceName,
      user: email,
      results,
      before_after_bootstrap_explain: {
        old_protected_docs_startup_fanout: {
          description: 'Pre-bootstrap protected docs startup fanout: auth plus app-shell list/status requests. EXPLAIN rows below use equivalent constituent SQL definitions so this report is runnable against the current schema; request-count evidence remains in perf:query-count-api.',
          requests: bootstrapEvidence.old_protected_docs_startup_fanout,
          results: await explainEvidenceGroup(client, oldFanoutQueries(bootstrapEvidence)),
        },
        current_bootstrap: {
          description: 'Current protected startup hydration through /api/bootstrap constituent SQL.',
          endpoint: '/api/bootstrap',
          sprint_context: sprintContext,
          results: await explainEvidenceGroup(client, bootstrapEvidence.current_bootstrap),
        },
      },
    };

    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`EXPLAIN report written to ${outputPath}`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
