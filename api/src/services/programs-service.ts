// Program document writes: create, update, delete, and merge (capability-guarded).
import type { Pool, PoolClient } from 'pg';
import type { z } from 'zod';
import { pool } from '../db/client.js';
import type { Principal } from '../security/principal.js';
import { logAuditEvent } from './audit.js';
import type { Request } from 'express';
import {
  guardDocumentCreate,
  guardDocumentMutation,
  mutationGuardDenial,
} from './mutation-capability-guard.js';
import { createProgramSchema, updateProgramSchema } from '../schemas/programs.js';
import {
  visibleAssociatedDocumentCountSql,
  visibleDocumentPredicate,
} from './document-graph-visibility.js';

type QueryRunner = Pick<Pool | PoolClient, 'query'>;

type MergeCountRow = {
  document_type: string;
  count: string | number;
};

type CountRow = {
  count: string | number;
};

function toNumber(value: string | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  return typeof value === 'number' ? value : Number(value);
}

export type ProgramProperties = {
  color?: string;
  emoji?: string | null;
  prefix?: string;
  owner_id?: string | null;
  accountable_id?: string | null;
  consulted_ids?: string[];
  informed_ids?: string[];
};

export type ProgramRow = {
  id: string;
  title: string;
  properties: ProgramProperties | null;
  archived_at: Date | null;
  created_at: Date;
  updated_at: Date;
  issue_count?: string | number | null;
  sprint_count?: string | number | null;
  owner_id?: string | null;
  owner_name?: string | null;
  owner_email?: string | null;
};

type ProgramOwnerRow = {
  id: string;
  name: string;
  email: string;
};

type MergePreviewProgramRow = {
  id: string;
  title: string;
  properties: ProgramProperties | null;
  archived_at: Date | null;
};

type MovedChildRow = {
  document_id: string;
  document_type: string;
};

export type ProgramServiceResult<T> =
  | { ok: true; status: number; body: T }
  | { ok: false; status: number; body: Record<string, unknown> };

function mapProgramGuardDenial(denial: Parameters<typeof mutationGuardDenial>[0]): ProgramServiceResult<never> {
  return mutationGuardDenial(denial);
}

function requireFirstRow<T>(rows: T[]): T {
  const row = rows[0];
  if (!row) throw new Error('Expected query to return a row');
  return row;
}

async function resolveProgramsForMerge(
  db: QueryRunner,
  principal: Principal,
  sourceId: string,
  targetId: string,
  workspaceId: string
): Promise<
  | { ok: true; source: MergePreviewProgramRow; target: MergePreviewProgramRow }
  | { ok: false; status: number; body: Record<string, unknown> }
> {
  if (sourceId === targetId) {
    return { ok: false, status: 400, body: { error: 'Cannot merge a program into itself' } };
  }

  const sourceGuard = await guardDocumentMutation(
    db,
    principal,
    { action: 'write', documentId: sourceId, expectedType: 'program' },
    { notFoundMessage: 'Source program not found' }
  );
  if (!sourceGuard.ok) {
    return { ok: false, status: sourceGuard.status, body: sourceGuard.body };
  }

  const targetGuard = await guardDocumentMutation(
    db,
    principal,
    { action: 'write', documentId: targetId, expectedType: 'program' },
    { notFoundMessage: 'Target program not found' }
  );
  if (!targetGuard.ok) {
    return { ok: false, status: targetGuard.status, body: targetGuard.body };
  }

  const programsResult = await db.query<MergePreviewProgramRow>(
    `SELECT id, title, properties, archived_at
     FROM documents
     WHERE id = ANY($1) AND workspace_id = $2 AND document_type = 'program'`,
    [[sourceId, targetId], workspaceId]
  );

  const sourceProgram = programsResult.rows.find((row) => row.id === sourceId);
  const targetProgram = programsResult.rows.find((row) => row.id === targetId);

  if (!sourceProgram) {
    return { ok: false, status: 404, body: { error: 'Source program not found' } };
  }
  if (!targetProgram) {
    return { ok: false, status: 404, body: { error: 'Target program not found' } };
  }
  if (sourceProgram.archived_at) {
    return { ok: false, status: 400, body: { error: 'Source program is archived' } };
  }
  if (targetProgram.archived_at) {
    return { ok: false, status: 400, body: { error: 'Target program is archived' } };
  }

  return { ok: true, source: sourceProgram, target: targetProgram };
}

export async function previewProgramMerge(input: {
  principal: Principal;
  sourceId: string;
  targetId: string;
  workspaceId: string;
  userId: string;
  isAdmin: boolean;
}): Promise<
  ProgramServiceResult<{
    source: { id: string; name: string };
    target: { id: string; name: string };
    counts: Record<string, number>;
    conflicts: Array<{ type: string; message: string }>;
  }>
> {
  const { principal, sourceId, targetId, workspaceId, userId, isAdmin } = input;

  const resolved = await resolveProgramsForMerge(pool, principal, sourceId, targetId, workspaceId);
  if (!resolved.ok) return resolved;

  const { source: sourceProgram, target: targetProgram } = resolved;

  const countsResult = await pool.query<MergeCountRow>(
    `SELECT d.document_type, COUNT(*) as count
     FROM documents d
     JOIN document_associations da ON da.document_id = d.id AND da.related_id = $1 AND da.relationship_type = 'program'
     WHERE ${visibleDocumentPredicate('d', '$2', '$3')}
     GROUP BY d.document_type`,
    [sourceId, userId, isAdmin]
  );

  const childDocsResult = await pool.query<CountRow>(
    `SELECT COUNT(*) as count FROM documents d WHERE d.parent_id = $1 AND ${visibleDocumentPredicate('d', '$2', '$3')}`,
    [sourceId, userId, isAdmin]
  );

  const counts: Record<string, number> = {
    projects: 0,
    issues: 0,
    sprints: 0,
    wikis: toNumber(childDocsResult.rows[0]?.count),
  };

  for (const row of countsResult.rows) {
    if (row.document_type === 'project') counts.projects = toNumber(row.count);
    else if (row.document_type === 'issue') counts.issues = toNumber(row.count);
    else if (row.document_type === 'sprint') counts.sprints = toNumber(row.count);
  }

  const conflicts: Array<{ type: string; message: string }> = [];
  const sourcePrefix =
    typeof sourceProgram.properties?.prefix === 'string' ? sourceProgram.properties.prefix : null;
  const targetPrefix =
    typeof targetProgram.properties?.prefix === 'string' ? targetProgram.properties.prefix : null;
  if (sourcePrefix && targetPrefix) {
    conflicts.push({
      type: 'prefix_conflict',
      message: `Both programs have prefixes set (source: "${sourcePrefix}", target: "${targetPrefix}"). The source prefix will be cleared during merge.`,
    });
  }

  return {
    ok: true,
    status: 200,
    body: {
      source: { id: sourceProgram.id, name: sourceProgram.title },
      target: { id: targetProgram.id, name: targetProgram.title },
      counts,
      conflicts,
    },
  };
}

export function extractProgramFromRow(row: ProgramRow) {
  const props = row.properties || {};
  return {
    id: row.id,
    name: row.title,
    color: props.color || '#6366f1',
    emoji: props.emoji || null,
    archived_at: row.archived_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
    issue_count: row.issue_count,
    sprint_count: row.sprint_count,
    owner: row.owner_name
      ? {
          id: row.owner_id,
          name: row.owner_name,
          email: row.owner_email,
        }
      : null,
    owner_id: props.owner_id || null,
    accountable_id: props.accountable_id || null,
    consulted_ids: props.consulted_ids || [],
    informed_ids: props.informed_ids || [],
  };
}

export async function createProgram(input: {
  principal: Principal;
  workspaceId: string;
  userId: string;
  data: z.infer<typeof createProgramSchema>;
}): Promise<
  ProgramServiceResult<
    ReturnType<typeof extractProgramFromRow> & {
      owner: { id: string; name: string; email: string } | null;
    }
  >
> {
  const { principal, workspaceId, userId, data } = input;
  const { title, color, emoji, owner_id, accountable_id, consulted_ids, informed_ids } = data;

  const createDenied = await guardDocumentCreate(pool, principal);
  if (!createDenied.ok) return mapProgramGuardDenial(createDenied);

  const properties: Record<string, unknown> = {
    color: color || '#6366f1',
    owner_id,
    accountable_id,
    consulted_ids,
    informed_ids,
  };
  if (emoji) properties.emoji = emoji;

  const result = await pool.query<ProgramRow>(
    `INSERT INTO documents (workspace_id, document_type, title, properties, created_by)
     VALUES ($1, 'program', $2, $3, $4)
     RETURNING id, title, properties, archived_at, created_at, updated_at`,
    [workspaceId, title, JSON.stringify(properties), userId]
  );

  const userResult = await pool.query<ProgramOwnerRow>(
    'SELECT id, name, email FROM users WHERE id = $1',
    [userId]
  );
  const user = userResult.rows[0];

  return {
    ok: true,
    status: 201,
    body: {
      ...extractProgramFromRow(requireFirstRow(result.rows)),
      issue_count: 0,
      sprint_count: 0,
      owner: user ? { id: user.id, name: user.name, email: user.email } : null,
    },
  };
}

export async function updateProgram(input: {
  principal: Principal;
  programId: string;
  workspaceId: string;
  isAdmin: boolean;
  data: z.infer<typeof updateProgramSchema>;
}): Promise<ProgramServiceResult<ReturnType<typeof extractProgramFromRow>>> {
  const { principal, programId, workspaceId, isAdmin, data } = input;

  const writeDenied = await guardDocumentMutation(
    pool,
    principal,
    { action: 'write', documentId: programId, expectedType: 'program' },
    { notFoundMessage: 'Program not found' }
  );
  if (!writeDenied.ok) return mapProgramGuardDenial(writeDenied);

  const currentProps = (writeDenied.document?.properties ?? {}) as ProgramProperties;
  const updates: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;

  if (data.title !== undefined) {
    updates.push(`title = $${paramIndex++}`);
    values.push(data.title);
  }

  const newProps = { ...currentProps };
  let propsChanged = false;

  if (data.color !== undefined) {
    newProps.color = data.color;
    propsChanged = true;
  }
  if (data.emoji !== undefined) {
    newProps.emoji = data.emoji;
    propsChanged = true;
  }
  if (data.owner_id !== undefined) {
    newProps.owner_id = data.owner_id;
    propsChanged = true;
  }
  if (data.accountable_id !== undefined) {
    if (!isAdmin) {
      return { ok: false, status: 403, body: { error: 'Only workspace admins can change accountable_id' } };
    }
    newProps.accountable_id = data.accountable_id;
    propsChanged = true;
  }
  if (data.consulted_ids !== undefined) {
    newProps.consulted_ids = data.consulted_ids;
    propsChanged = true;
  }
  if (data.informed_ids !== undefined) {
    newProps.informed_ids = data.informed_ids;
    propsChanged = true;
  }

  if (propsChanged) {
    updates.push(`properties = $${paramIndex++}`);
    values.push(JSON.stringify(newProps));
  }

  if (data.archived_at !== undefined) {
    updates.push(`archived_at = $${paramIndex++}`);
    values.push(data.archived_at);
  }

  if (updates.length === 0) {
    return { ok: false, status: 400, body: { error: 'No fields to update' } };
  }

  updates.push(`updated_at = now()`);

  await pool.query(
    `UPDATE documents SET ${updates.join(', ')}
     WHERE id = $${paramIndex} AND workspace_id = $${paramIndex + 1} AND document_type = 'program'`,
    [...values, programId, workspaceId]
  );

  const result = await pool.query<ProgramRow>(
    `SELECT d.id, d.title, d.properties, d.archived_at, d.created_at, d.updated_at,
            COALESCE((d.properties->>'owner_id')::uuid, d.created_by) as owner_id,
            u.name as owner_name, u.email as owner_email
     FROM documents d
     LEFT JOIN users u ON u.id = COALESCE((d.properties->>'owner_id')::uuid, d.created_by)
     WHERE d.id = $1 AND d.document_type = 'program'`,
    [programId]
  );

  return { ok: true, status: 200, body: extractProgramFromRow(requireFirstRow(result.rows)) };
}

export async function deleteProgram(input: {
  principal: Principal;
  programId: string;
  workspaceId: string;
}): Promise<ProgramServiceResult<null>> {
  const { principal, programId, workspaceId } = input;

  const writeDenied = await guardDocumentMutation(
    pool,
    principal,
    { action: 'write', documentId: programId, expectedType: 'program' },
    { notFoundMessage: 'Program not found' }
  );
  if (!writeDenied.ok) return mapProgramGuardDenial(writeDenied);

  await pool.query(
    `DELETE FROM document_associations WHERE related_id = $1 AND relationship_type = 'program'`,
    [programId]
  );

  const deleted = await pool.query<{ id: string }>(
    `DELETE FROM documents WHERE id = $1 AND workspace_id = $2 AND document_type = 'program' RETURNING id`,
    [programId, workspaceId]
  );
  if (deleted.rows.length === 0) {
    return { ok: false, status: 404, body: { error: 'Program not found' } };
  }

  return { ok: true, status: 204, body: null };
}

export async function mergePrograms(input: {
  client: PoolClient;
  principal: Principal;
  sourceId: string;
  targetId: string;
  workspaceId: string;
  userId: string;
  confirmName: string;
  isAdmin: boolean;
  req: Request;
}): Promise<ProgramServiceResult<ReturnType<typeof extractProgramFromRow>>> {
  const { client, principal, sourceId, targetId, workspaceId, userId, confirmName, isAdmin, req } =
    input;

  const resolved = await resolveProgramsForMerge(client, principal, sourceId, targetId, workspaceId);
  if (!resolved.ok) return resolved;

  const { source: sourceProgram, target: targetProgram } = resolved;

  if (confirmName !== sourceProgram.title) {
    return {
      ok: false,
      status: 409,
      body: { error: 'Confirmation name does not match the source program name' },
    };
  }

  await client.query('BEGIN');

  try {
    const childrenResult = await client.query<MovedChildRow>(
    `SELECT da.document_id, d.document_type
     FROM document_associations da
     JOIN documents d ON d.id = da.document_id
     WHERE da.related_id = $1 AND da.relationship_type = 'program'`,
    [sourceId]
  );

  await client.query(
    `DELETE FROM document_associations
     WHERE related_id = $1 AND relationship_type = 'program'
       AND document_id IN (
         SELECT document_id FROM document_associations
         WHERE related_id = $2 AND relationship_type = 'program'
       )`,
    [sourceId, targetId]
  );

  const reParentResult = await client.query(
    `UPDATE document_associations
     SET related_id = $1
     WHERE related_id = $2 AND relationship_type = 'program'`,
    [targetId, sourceId]
  );

  const childReParentResult = await client.query(
    `UPDATE documents SET parent_id = $1 WHERE parent_id = $2`,
    [targetId, sourceId]
  );

  for (const child of childrenResult.rows) {
    await client.query(
      `INSERT INTO document_history (document_id, field, old_value, new_value, changed_by)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        child.document_id,
        'belongs_to',
        JSON.stringify([{ id: sourceId, type: 'program' }]),
        JSON.stringify([{ id: targetId, type: 'program' }]),
        userId,
      ]
    );
  }

  const mergedProps = {
    ...(sourceProgram.properties || {}),
    merged_into_id: targetId,
    merged_at: new Date().toISOString(),
    merged_by: userId,
  };

  await client.query(
    `UPDATE documents
     SET properties = $1, archived_at = NOW(), updated_at = NOW()
     WHERE id = $2`,
    [JSON.stringify(mergedProps), sourceId]
  );

  await logAuditEvent({
    workspaceId,
    actorUserId: userId,
    action: 'program.merge',
    resourceType: 'program',
    resourceId: sourceId,
    details: {
      source_id: sourceId,
      source_name: sourceProgram.title,
      target_id: targetId,
      target_name: targetProgram.title,
      entities_moved: {
        associations: reParentResult.rowCount,
        child_docs: childReParentResult.rowCount,
      },
    },
    req,
  });

  const result = await client.query<ProgramRow>(
    `SELECT d.id, d.title, d.properties, d.archived_at, d.created_at, d.updated_at,
            COALESCE((d.properties->>'owner_id')::uuid, d.created_by) as owner_id,
            u.name as owner_name, u.email as owner_email,
            (${visibleAssociatedDocumentCountSql('i', 'program', 'issue', 'd', '$2', '$3')}) as issue_count,
            (${visibleAssociatedDocumentCountSql('s', 'program', 'sprint', 'd', '$2', '$3')}) as sprint_count
     FROM documents d
     LEFT JOIN users u ON u.id = COALESCE((d.properties->>'owner_id')::uuid, d.created_by)
     WHERE d.id = $1 AND d.document_type = 'program'`,
    [targetId, userId, isAdmin]
  );

  await client.query('COMMIT');

    return { ok: true, status: 200, body: extractProgramFromRow(requireFirstRow(result.rows)) };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}