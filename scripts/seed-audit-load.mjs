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
const issueCount = positiveInt(process.env.AUDIT_LOAD_ISSUES, 120);
const projectCount = positiveInt(process.env.AUDIT_LOAD_PROJECTS, 30);
const programCount = positiveInt(process.env.AUDIT_LOAD_PROGRAMS, 8);
const weeklyArtifactUsers = positiveInt(process.env.AUDIT_LOAD_WEEKLY_USERS, 40);
const auditLogCount = positiveInt(process.env.AUDIT_LOAD_AUDIT_LOGS, 10000);
const userCount = positiveInt(process.env.AUDIT_LOAD_USERS, 40);
const sprintCount = positiveInt(process.env.AUDIT_LOAD_SPRINTS, 20);
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

function richContent(title, paragraphs) {
  return {
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: title }] },
      ...paragraphs.map((text) => ({
        type: 'paragraph',
        content: [{ type: 'text', text }],
      })),
    ],
  };
}

function isoDateForWeekOffset(offset, dayOffset = 0) {
  const date = new Date();
  const dayOfWeek = date.getDay();
  const daysSinceMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  date.setDate(date.getDate() - daysSinceMonday + offset * 7 + dayOffset);
  return date.toISOString().slice(0, 10);
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
    `SELECT id, title
     FROM documents
     WHERE workspace_id = $1
       AND document_type = 'sprint'
       AND archived_at IS NULL
       AND deleted_at IS NULL
     ORDER BY COALESCE((properties->>'sprint_number')::int, 0), created_at ASC`,
    [workspaceId]
  );

  return { inserted, total: total.rowCount, rows: total.rows };
}

async function seedPrograms(client, workspaceId, actorUserId) {
  let inserted = 0;

  for (let index = 1; index <= programCount; index++) {
    const sequence = String(index).padStart(3, '0');
    const result = await client.query(
      `INSERT INTO documents (workspace_id, document_type, title, content, properties, created_by)
       SELECT $1, 'program', $2, $3::jsonb, $4::jsonb, $5
       WHERE NOT EXISTS (
         SELECT 1 FROM documents
         WHERE workspace_id = $1
           AND document_type = 'program'
           AND properties->>'audit_load_tag' = $6
           AND properties->>'audit_load_sequence' = $7
       )`,
      [
        workspaceId,
        `Audit Program ${sequence}`,
        JSON.stringify(richContent(`Audit Program ${sequence}`, [
          'Program used by the large benchmark fixture to exercise bootstrap program summaries.',
          `Portfolio lane ${index % 4} owns projects, issues, weekly planning, and status review traffic.`,
        ])),
        JSON.stringify({
          audit_load_tag: tag,
          audit_load_sequence: index,
          prefix: `AL${sequence}`,
          color: ['#2563EB', '#059669', '#D97706', '#7C3AED'][index % 4],
        }),
        actorUserId,
        tag,
        String(index),
      ]
    );
    inserted += result.rowCount;
  }

  const rows = await client.query(
    `SELECT id, title
     FROM documents
     WHERE workspace_id = $1
       AND document_type = 'program'
       AND archived_at IS NULL
       AND deleted_at IS NULL
     ORDER BY created_at ASC, title ASC`,
    [workspaceId]
  );

  return { inserted, total: rows.rowCount, rows: rows.rows };
}

async function seedProjects(client, workspaceId, actorUserId, programs) {
  const people = await client.query(
    `SELECT id, properties->>'user_id' AS user_id
     FROM documents
     WHERE workspace_id = $1
       AND document_type = 'person'
       AND properties ? 'user_id'
     ORDER BY created_at ASC
     LIMIT $2`,
    [workspaceId, Math.max(userCount, 1)]
  );
  let inserted = 0;

  for (let index = 1; index <= projectCount; index++) {
    const sequence = String(index).padStart(3, '0');
    const owner = people.rows[(index - 1) % Math.max(people.rows.length, 1)];
    const result = await client.query(
      `INSERT INTO documents (workspace_id, document_type, title, content, properties, created_by)
       SELECT $1, 'project', $2, $3::jsonb, $4::jsonb, $5
       WHERE NOT EXISTS (
         SELECT 1 FROM documents
         WHERE workspace_id = $1
           AND document_type = 'project'
           AND properties->>'audit_load_tag' = $6
           AND properties->>'audit_load_sequence' = $7
       )
       RETURNING id`,
      [
        workspaceId,
        `Audit Project ${sequence}`,
        JSON.stringify(richContent(`Audit Project ${sequence}`, [
          `Synthetic project ${index} with roadmap, delivery, risk, and operational notes.`,
          `Used to make /api/projects and /api/bootstrap exercise project counts and inferred status.`,
        ])),
        JSON.stringify({
          audit_load_tag: tag,
          audit_load_sequence: index,
          owner_id: owner?.user_id || actorUserId,
          status: ['on_track', 'at_risk', 'blocked', 'complete'][index % 4],
          priority: ['low', 'medium', 'high'][index % 3],
          health_note: `Fixture project ${index} has enough metadata to avoid empty-card performance tests.`,
        }),
        actorUserId,
        tag,
        String(index),
      ]
    );
    const projectId = result.rows[0]?.id;
    if (projectId) inserted++;

    const existing = projectId
      ? { id: projectId }
      : (await client.query(
          `SELECT id
           FROM documents
           WHERE workspace_id = $1
             AND document_type = 'project'
             AND properties->>'audit_load_tag' = $2
             AND properties->>'audit_load_sequence' = $3
           LIMIT 1`,
          [workspaceId, tag, String(index)]
        )).rows[0];
    const program = programs[(index - 1) % Math.max(programs.length, 1)];
    if (existing?.id && program?.id) {
      await client.query(
        `INSERT INTO document_associations (document_id, related_id, relationship_type, metadata)
         VALUES ($1, $2, 'program', $3::jsonb)
         ON CONFLICT (document_id, related_id, relationship_type) DO NOTHING`,
        [existing.id, program.id, JSON.stringify({ audit_load_tag: tag })]
      );
    }
  }

  const rows = await client.query(
    `SELECT id, title
     FROM documents
     WHERE workspace_id = $1
       AND document_type = 'project'
       AND archived_at IS NULL
       AND deleted_at IS NULL
     ORDER BY created_at ASC, title ASC`,
    [workspaceId]
  );

  return { inserted, total: rows.rowCount, rows: rows.rows };
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
      values.push(`($1, 'wiki', $${offset + 1}, $${offset + 2}::jsonb, $${offset + 3}::jsonb, $2)`);
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

async function seedIssues(client, workspaceId, actorUserId, projects, sprints, programs) {
  const people = await client.query(
    `SELECT id, properties->>'user_id' AS user_id
     FROM documents
     WHERE workspace_id = $1
       AND document_type = 'person'
       AND properties ? 'user_id'
     ORDER BY created_at ASC
     LIMIT $2`,
    [workspaceId, Math.max(userCount, 1)]
  );
  let inserted = 0;

  for (let index = 1; index <= issueCount; index++) {
    const sequence = String(index).padStart(3, '0');
    const owner = people.rows[(index - 1) % Math.max(people.rows.length, 1)];
    const state = ['todo', 'in_progress', 'in_review', 'done', 'cancelled'][index % 5];
    const result = await client.query(
      `INSERT INTO documents (
         workspace_id, document_type, title, content, properties, created_by,
         started_at, completed_at, cancelled_at
       )
       SELECT $1, 'issue', $2, $3::jsonb, $4::jsonb, $5,
              CASE WHEN $8 IN ('in_progress', 'in_review', 'done') THEN NOW() - (($6::int % 14) || ' days')::interval ELSE NULL END,
              CASE WHEN $8 = 'done' THEN NOW() - (($6::int % 7) || ' days')::interval ELSE NULL END,
              CASE WHEN $8 = 'cancelled' THEN NOW() - (($6::int % 5) || ' days')::interval ELSE NULL END
       WHERE NOT EXISTS (
         SELECT 1 FROM documents
         WHERE workspace_id = $1
           AND document_type = 'issue'
           AND properties->>'audit_load_tag' = $7
           AND properties->>'audit_load_sequence' = $6::text
       )
       RETURNING id`,
      [
        workspaceId,
        `Audit Issue ${sequence}: ${['Reduce queue depth', 'Tighten workflow', 'Repair stale read', 'Document rollout'][index % 4]}`,
        JSON.stringify(richContent(`Audit Issue ${sequence}`, [
          `Issue ${index} includes acceptance criteria, operational notes, and fixture text for realistic list payloads.`,
          `Owner rotation, project links, sprint links, and program links make endpoint joins non-trivial.`,
          `Search terms: ${searchTermsForIndex(index).join(', ')}.`,
        ])),
        JSON.stringify({
          audit_load_tag: tag,
          audit_load_sequence: index,
          audit_load_search_terms: searchTermsForIndex(index),
          state,
          priority: ['low', 'medium', 'high', 'critical'][index % 4],
          assignee_id: owner?.user_id || actorUserId,
          estimate: (index % 13) + 1,
          source: 'large-fixture',
          acceptance_criteria: [
            `Fixture issue ${index} has a concrete owner.`,
            'It belongs to a project, sprint, and program.',
            'It carries enough text to avoid empty payload benchmarks.',
          ],
        }),
        actorUserId,
        String(index),
        tag,
        state,
      ]
    );
    const issueId = result.rows[0]?.id || (await client.query(
      `SELECT id
       FROM documents
       WHERE workspace_id = $1
         AND document_type = 'issue'
         AND properties->>'audit_load_tag' = $2
         AND properties->>'audit_load_sequence' = $3
       LIMIT 1`,
      [workspaceId, tag, String(index)]
    )).rows[0]?.id;
    if (result.rows[0]?.id) inserted++;
    if (!issueId) continue;

    const project = projects[(index - 1) % Math.max(projects.length, 1)];
    const sprint = sprints[(index - 1) % Math.max(sprints.length, 1)];
    const program = programs[(index - 1) % Math.max(programs.length, 1)];
    for (const [related, relationshipType] of [
      [project, 'project'],
      [sprint, 'sprint'],
      [program, 'program'],
    ]) {
      if (!related?.id) continue;
      await client.query(
        `INSERT INTO document_associations (document_id, related_id, relationship_type, metadata)
         VALUES ($1, $2, $3, $4::jsonb)
         ON CONFLICT (document_id, related_id, relationship_type) DO NOTHING`,
        [issueId, related.id, relationshipType, JSON.stringify({ audit_load_tag: tag })]
      );
    }
  }

  const total = await client.query(
    `SELECT COUNT(*)::int AS count
     FROM documents
     WHERE workspace_id = $1
       AND document_type = 'issue'
       AND archived_at IS NULL
       AND deleted_at IS NULL`,
    [workspaceId]
  );

  return { inserted, total: total.rows[0].count };
}

async function seedWeeklyArtifacts(client, workspaceId, actorUserId, sprints) {
  const people = await client.query(
    `SELECT id AS person_id, properties->>'user_id' AS user_id, title
     FROM documents
     WHERE workspace_id = $1
       AND document_type = 'person'
       AND properties ? 'user_id'
     ORDER BY created_at ASC
     LIMIT $2`,
    [workspaceId, weeklyArtifactUsers]
  );
  let inserted = 0;

  for (const [personIndex, person] of people.rows.entries()) {
    for (const [sprintIndex, sprint] of sprints.slice(0, Math.min(sprints.length, sprintCount)).entries()) {
      const sequence = `${personIndex + 1}-${sprintIndex + 1}`;
      const weekStart = isoDateForWeekOffset(sprintIndex - Math.min(6, sprintIndex));
      const weeklyDocs = [
        {
          type: 'weekly_plan',
          title: `Audit Plan W${sprintIndex + 1} ${person.title}`,
          body: [
            `Plan for ${person.title} in fixture week ${sprintIndex + 1}.`,
            'Includes commitments, risks, assumptions, and dependency notes for dashboard realism.',
          ],
          properties: {
            week_start: weekStart,
            person_id: person.person_id,
            owner_id: person.user_id,
            outcome: 'submitted',
            plan_approval: personIndex % 5 === 0 ? 'changes_requested' : 'approved',
          },
        },
        {
          type: 'weekly_retro',
          title: `Audit Retro W${sprintIndex + 1} ${person.title}`,
          body: [
            `Retro for ${person.title} in fixture week ${sprintIndex + 1}.`,
            'Captures completed work, carryover, decision quality, and follow-up notes.',
          ],
          properties: {
            week_start: weekStart,
            person_id: person.person_id,
            owner_id: person.user_id,
            outcome: 'submitted',
            review_approval: personIndex % 7 === 0 ? 'needs_review' : 'approved',
          },
        },
        {
          type: 'standup',
          title: `Audit Standup W${sprintIndex + 1} ${person.title}`,
          body: [
            `Yesterday: moved fixture issue ${(personIndex + sprintIndex) % Math.max(issueCount, 1)}.`,
            'Today: continue project delivery and unblock review queue.',
            'Blockers: synthetic dependency notes for dashboard status tests.',
          ],
          properties: {
            standup_date: isoDateForWeekOffset(sprintIndex - Math.min(6, sprintIndex), 2),
            author_id: person.user_id,
            person_id: person.person_id,
          },
        },
      ];

      for (const doc of weeklyDocs) {
        const result = await client.query(
          `INSERT INTO documents (workspace_id, document_type, title, content, parent_id, properties, created_by)
           SELECT $1, $2::document_type, $3, $4::jsonb, $5, $6::jsonb, $7
           WHERE NOT EXISTS (
             SELECT 1 FROM documents
             WHERE workspace_id = $1
               AND document_type = $2::document_type
               AND properties->>'audit_load_tag' = $8
               AND properties->>'audit_load_sequence' = $9
           )
           RETURNING id`,
          [
            workspaceId,
            doc.type,
            doc.title,
            JSON.stringify(richContent(doc.title, doc.body)),
            sprint.id,
            JSON.stringify({ ...doc.properties, audit_load_tag: tag, audit_load_sequence: `${doc.type}-${sequence}` }),
            actorUserId,
            tag,
            `${doc.type}-${sequence}`,
          ]
        );
        const docId = result.rows[0]?.id || (await client.query(
          `SELECT id
           FROM documents
           WHERE workspace_id = $1
             AND document_type = $2::document_type
             AND properties->>'audit_load_tag' = $3
             AND properties->>'audit_load_sequence' = $4
           LIMIT 1`,
          [workspaceId, doc.type, tag, `${doc.type}-${sequence}`]
        )).rows[0]?.id;
        if (result.rows[0]?.id) inserted++;
        if (docId) {
          await client.query(
            `INSERT INTO document_associations (document_id, related_id, relationship_type, metadata)
             VALUES ($1, $2, 'sprint', $3::jsonb)
             ON CONFLICT (document_id, related_id, relationship_type) DO NOTHING`,
            [docId, sprint.id, JSON.stringify({ audit_load_tag: tag })]
          );
        }
      }
    }
  }

  const total = await client.query(
    `SELECT COUNT(*)::int AS count
     FROM documents
     WHERE workspace_id = $1
       AND properties->>'audit_load_tag' = $2
       AND document_type IN ('weekly_plan', 'weekly_retro', 'standup')`,
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
    const programs = await seedPrograms(client, workspaceId, actorUserId);
    const projects = await seedProjects(client, workspaceId, actorUserId, programs.rows);
    const sprints = await seedSprints(client, workspaceId, actorUserId);
    const documents = await seedDocuments(client, workspaceId, actorUserId);
    const issues = await seedIssues(client, workspaceId, actorUserId, projects.rows, sprints.rows, programs.rows);
    const weeklyArtifacts = await seedWeeklyArtifacts(client, workspaceId, actorUserId, sprints.rows);
    const auditLogs = await seedAuditLogs(client, workspaceId, actorUserId);
    await client.query('COMMIT');
    console.log(JSON.stringify({
      tag,
      workspace: workspaceName,
      cleanup: false,
      profile: {
        documents_minimum: documentCount,
        issues_minimum: issueCount,
        users_minimum: userCount,
        sprints_minimum: sprintCount,
        projects_minimum: projectCount,
        programs_minimum: programCount,
      },
      search_terms: searchTerms,
      users,
      programs: { inserted: programs.inserted, total: programs.total },
      projects: { inserted: projects.inserted, total: projects.total },
      sprints: { inserted: sprints.inserted, total: sprints.total },
      documents,
      issues,
      weekly_artifacts: weeklyArtifacts,
      audit_logs: auditLogs,
    }, null, 2));
  }
} catch (error) {
  await client.query('ROLLBACK');
  console.error(error);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
