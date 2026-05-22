/**
 * Shared utilities for document CRUD operations
 *
 * These utilities extract common patterns from route files to reduce duplication.
 * All functions operate on the unified document model.
 */

import { pool } from '../db/client.js';
import type { BelongsTo, BelongsToType } from '@ship/shared';

// =============================================================================
// Types
// =============================================================================

type QueryRunner = { query: typeof pool.query };

type BelongsToRow = {
  id: string;
  type: BelongsToType;
  title: string | null;
  color: string | null;
};

type BatchBelongsToRow = BelongsToRow & {
  document_id: string;
};

type UserRow = {
  id: string;
  name: string;
  email: string;
};

type DocumentFieldHistoryRow = {
  id: number;
  document_id: string;
  field: string;
  old_value: string | null;
  new_value: string | null;
  changed_by: string | null;
  automated_by: string | null;
  created_at: Date;
  changed_by_name: string | null;
  changed_by_email: string | null;
};

function extractBelongsToFromRow(row: BelongsToRow): BelongsTo {
  return {
    id: row.id,
    type: row.type,
    title: row.title || undefined,
    color: row.color || undefined,
  };
}

function extractFieldHistoryFromRow(row: DocumentFieldHistoryRow): DocumentFieldHistoryEntry {
  return {
    id: row.id,
    documentId: row.document_id,
    field: row.field,
    oldValue: row.old_value,
    newValue: row.new_value,
    changedBy: row.changed_by,
    changedByName: row.changed_by_name || undefined,
    changedByEmail: row.changed_by_email || undefined,
    automatedBy: row.automated_by,
    createdAt: row.created_at,
  };
}

/**
 * Fields that are tracked in document_history for audit trail
 */
export const TRACKED_FIELDS = [
  'title',
  'state',
  'priority',
  'assignee_id',
  'estimate',
  'belongs_to',
];

// =============================================================================
// Document History
// =============================================================================

/**
 * Log a field change to document_history for audit trail
 *
 * @example
 * await logDocumentChange(issueId, 'state', 'triage', 'in_progress', userId);
 * await logDocumentChange(issueId, 'priority', null, 'high', userId, 'system');
 */
export async function logDocumentChange(
  documentId: string,
  field: string,
  oldValue: string | null,
  newValue: string | null,
  changedBy: string,
  automatedBy?: string,
  queryRunner?: QueryRunner
): Promise<void> {
  const db = queryRunner || pool;
  await db.query(
    `INSERT INTO document_history (document_id, field, old_value, new_value, changed_by, automated_by)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [documentId, field, oldValue, newValue, changedBy, automatedBy ?? null]
  );
}

// =============================================================================
// State Timestamp Updates
// =============================================================================

/**
 * Get timestamp column updates based on state transitions
 *
 * Returns SQL expressions for updating started_at, completed_at, etc.
 * when an issue's state changes.
 *
 * @example
 * const updates = getTimestampUpdates('triage', 'in_progress');
 * // Returns: { started_at: 'COALESCE(started_at, NOW())' }
 */
export function getTimestampUpdates(
  oldState: string | null,
  newState: string
): Record<string, string> {
  const updates: Record<string, string> = {};

  if (newState === 'in_progress' && oldState !== 'in_progress') {
    if (oldState === 'done' || oldState === 'cancelled') {
      // Reopening from done/cancelled
      updates.reopened_at = 'NOW()';
    } else {
      // First time starting work
      updates.started_at = 'COALESCE(started_at, NOW())';
    }
  }
  if (newState === 'done' && oldState !== 'done') {
    updates.completed_at = 'COALESCE(completed_at, NOW())';
  }
  if (newState === 'cancelled' && oldState !== 'cancelled') {
    updates.cancelled_at = 'NOW()';
  }

  return updates;
}

// =============================================================================
// Document Associations
// =============================================================================

/**
 * Get belongs_to associations for a document from junction table
 *
 * Returns array of associations with their type, title, and color.
 *
 * @example
 * const associations = await getBelongsToAssociations(issueId);
 * // Returns: [{ id: '...', type: 'project', title: 'My Project', color: '#ff0000' }]
 */
export async function getBelongsToAssociations(
  documentId: string
): Promise<BelongsTo[]> {
  const result = await pool.query<BelongsToRow>(
    `SELECT da.related_id as id, da.relationship_type as type,
            d.title, d.properties->>'color' as color
     FROM document_associations da
     LEFT JOIN documents d ON da.related_id = d.id
     WHERE da.document_id = $1
     ORDER BY da.relationship_type, da.created_at`,
    [documentId]
  );
  return result.rows.map(extractBelongsToFromRow);
}

/**
 * Batch version of getBelongsToAssociations to avoid N+1 queries
 *
 * Fetches associations for multiple documents in one query, returning
 * a Map keyed by document ID.
 *
 * @example
 * const associationsMap = await getBelongsToAssociationsBatch(issueIds);
 * for (const issue of issues) {
 *   issue.belongs_to = associationsMap.get(issue.id) || [];
 * }
 */
export async function getBelongsToAssociationsBatch(
  documentIds: string[]
): Promise<Map<string, BelongsTo[]>> {
  if (documentIds.length === 0) {
    return new Map();
  }

  const result = await pool.query<BatchBelongsToRow>(
    `SELECT da.document_id, da.related_id as id, da.relationship_type as type,
            d.title, d.properties->>'color' as color
     FROM document_associations da
     LEFT JOIN documents d ON da.related_id = d.id
     WHERE da.document_id = ANY($1)
     ORDER BY da.document_id, da.relationship_type, da.created_at`,
    [documentIds]
  );

  // Group results by document_id
  const associationsMap = new Map<string, BelongsTo[]>();
  for (const row of result.rows) {
    const docId = row.document_id;
    if (!associationsMap.has(docId)) {
      associationsMap.set(docId, []);
    }
    const entries = associationsMap.get(docId);
    if (!entries) continue;
    entries.push(extractBelongsToFromRow(row));
  }

  return associationsMap;
}

/**
 * Sync belongs_to associations for a document
 *
 * Clears existing associations and creates new ones from the provided array.
 * Each entry should have { id, type } at minimum.
 *
 * @example
 * await syncBelongsToAssociations(issueId, [
 *   { id: projectId, type: 'project' },
 *   { id: sprintId, type: 'sprint' }
 * ]);
 */
export async function syncBelongsToAssociations(
  documentId: string,
  associations: Array<{ id: string; type: BelongsToType }>,
  queryRunner?: QueryRunner
): Promise<void> {
  const db = queryRunner || pool;
  // Delete existing associations
  await db.query(
    'DELETE FROM document_associations WHERE document_id = $1',
    [documentId]
  );

  // Insert new associations
  for (const assoc of associations) {
    await db.query(
      `INSERT INTO document_associations (document_id, related_id, relationship_type)
       VALUES ($1, $2, $3)
       ON CONFLICT (document_id, related_id, relationship_type) DO NOTHING`,
      [documentId, assoc.id, assoc.type]
    );
  }
}

/**
 * Add a single belongs_to association if it doesn't exist
 *
 * @example
 * await addBelongsToAssociation(issueId, sprintId, 'sprint');
 */
export async function addBelongsToAssociation(
  documentId: string,
  relatedId: string,
  relationshipType: BelongsToType,
  queryRunner?: QueryRunner
): Promise<void> {
  const db = queryRunner || pool;
  await db.query(
    `INSERT INTO document_associations (document_id, related_id, relationship_type)
     VALUES ($1, $2, $3)
     ON CONFLICT (document_id, related_id, relationship_type) DO NOTHING`,
    [documentId, relatedId, relationshipType]
  );
}

/**
 * Remove a single belongs_to association
 *
 * @example
 * await removeBelongsToAssociation(issueId, sprintId, 'sprint');
 */
export async function removeBelongsToAssociation(
  documentId: string,
  relatedId: string,
  relationshipType: BelongsToType,
  queryRunner?: QueryRunner
): Promise<void> {
  const db = queryRunner || pool;
  await db.query(
    `DELETE FROM document_associations
     WHERE document_id = $1 AND related_id = $2 AND relationship_type = $3`,
    [documentId, relatedId, relationshipType]
  );
}

/**
 * Remove all associations of a specific type for a document
 *
 * @example
 * await removeAssociationsByType(issueId, 'program');
 */
export async function removeAssociationsByType(
  documentId: string,
  relationshipType: BelongsToType,
  queryRunner?: QueryRunner
): Promise<void> {
  const db = queryRunner || pool;
  await db.query(
    `DELETE FROM document_associations
     WHERE document_id = $1 AND relationship_type = $2`,
    [documentId, relationshipType]
  );
}

/**
 * Sync a single relationship type for one document (e.g. program on projects).
 * Clears existing associations of that type, then inserts the new target when provided.
 */
export async function syncAssociationOfType(
  documentId: string,
  relationshipType: BelongsToType,
  relatedId: string | null,
  queryRunner?: QueryRunner
): Promise<void> {
  await removeAssociationsByType(documentId, relationshipType, queryRunner);
  if (relatedId) {
    await addBelongsToAssociation(documentId, relatedId, relationshipType, queryRunner);
  }
}

/**
 * Sync program association for a project document (API field: program_id).
 */
export async function syncProgramAssociation(
  documentId: string,
  programId: string | null,
  queryRunner?: QueryRunner
): Promise<void> {
  await syncAssociationOfType(documentId, 'program', programId, queryRunner);
}

/**
 * Bulk-sync one relationship type for many documents (e.g. bulk issue project/sprint moves).
 */
export async function syncAssociationOfTypeForDocuments(
  documentIds: string[],
  relationshipType: BelongsToType,
  relatedId: string | null,
  queryRunner?: QueryRunner
): Promise<void> {
  if (documentIds.length === 0) return;
  const db = queryRunner || pool;
  await db.query(
    `DELETE FROM document_associations
     WHERE document_id = ANY($1) AND relationship_type = $2`,
    [documentIds, relationshipType]
  );
  if (relatedId) {
    const insertValues = documentIds
      .map((_, i) => `($${i + 1}, $${documentIds.length + 1}, $${documentIds.length + 2})`)
      .join(', ');
    await db.query(
      `INSERT INTO document_associations (document_id, related_id, relationship_type)
       VALUES ${insertValues}
       ON CONFLICT (document_id, related_id, relationship_type) DO NOTHING`,
      [...documentIds, relatedId, relationshipType]
    );
  }
}

// =============================================================================
// Type-Specific Association Helpers
// =============================================================================

/**
 * Get the program association for a document
 *
 * @example
 * const program = await getProgramAssociation(projectId);
 * // Returns: { id: '...', title: 'My Program', color: '#ff0000' } or null
 */
export async function getProgramAssociation(
  documentId: string
): Promise<BelongsTo | null> {
  const result = await pool.query<BelongsToRow>(
    `SELECT da.related_id as id, da.relationship_type as type,
            d.title, d.properties->>'color' as color
     FROM document_associations da
     LEFT JOIN documents d ON da.related_id = d.id
     WHERE da.document_id = $1 AND da.relationship_type = 'program'
     LIMIT 1`,
    [documentId]
  );
  if (result.rows.length === 0) return null;
  const row = result.rows[0];
  if (!row) return null;
  return extractBelongsToFromRow(row);
}

/**
 * Get the project association for a document
 *
 * @example
 * const project = await getProjectAssociation(issueId);
 */
export async function getProjectAssociation(
  documentId: string
): Promise<BelongsTo | null> {
  const result = await pool.query<BelongsToRow>(
    `SELECT da.related_id as id, da.relationship_type as type,
            d.title, d.properties->>'color' as color
     FROM document_associations da
     LEFT JOIN documents d ON da.related_id = d.id
     WHERE da.document_id = $1 AND da.relationship_type = 'project'
     LIMIT 1`,
    [documentId]
  );
  if (result.rows.length === 0) return null;
  const row = result.rows[0];
  if (!row) return null;
  return extractBelongsToFromRow(row);
}

/**
 * Get the sprint association for a document
 *
 * @example
 * const sprint = await getSprintAssociation(issueId);
 */
export async function getSprintAssociation(
  documentId: string
): Promise<BelongsTo | null> {
  const result = await pool.query<BelongsToRow>(
    `SELECT da.related_id as id, da.relationship_type as type,
            d.title, d.properties->>'color' as color
     FROM document_associations da
     LEFT JOIN documents d ON da.related_id = d.id
     WHERE da.document_id = $1 AND da.relationship_type = 'sprint'
     LIMIT 1`,
    [documentId]
  );
  if (result.rows.length === 0) return null;
  const row = result.rows[0];
  if (!row) return null;
  return extractBelongsToFromRow(row);
}

/**
 * Update the program association for a document (replace existing)
 *
 * Pass null to remove the program association entirely.
 *
 * @example
 * await updateProgramAssociation(projectId, newProgramId);
 * await updateProgramAssociation(projectId, null); // Remove program
 */
export async function updateProgramAssociation(
  documentId: string,
  programId: string | null,
  queryRunner?: QueryRunner
): Promise<void> {
  // Remove existing program association
  await removeAssociationsByType(documentId, 'program', queryRunner);

  // Add new one if provided
  if (programId) {
    await addBelongsToAssociation(documentId, programId, 'program', queryRunner);
  }
}

/**
 * Update the project association for a document (replace existing)
 *
 * Pass null to remove the project association entirely.
 *
 * @example
 * await updateProjectAssociation(issueId, newProjectId);
 */
export async function updateProjectAssociation(
  documentId: string,
  projectId: string | null,
  queryRunner?: QueryRunner
): Promise<void> {
  await removeAssociationsByType(documentId, 'project', queryRunner);
  if (projectId) {
    await addBelongsToAssociation(documentId, projectId, 'project', queryRunner);
  }
}

/**
 * Update the sprint association for a document (replace existing)
 *
 * Pass null to remove the sprint association entirely.
 *
 * @example
 * await updateSprintAssociation(issueId, newSprintId);
 */
export async function updateSprintAssociation(
  documentId: string,
  sprintId: string | null,
  queryRunner?: QueryRunner
): Promise<void> {
  await removeAssociationsByType(documentId, 'sprint', queryRunner);
  if (sprintId) {
    await addBelongsToAssociation(documentId, sprintId, 'sprint', queryRunner);
  }
}

/**
 * Batch get program associations for multiple documents
 *
 * Returns a Map keyed by document ID with the program info.
 * Used to avoid N+1 queries when listing documents.
 *
 * @example
 * const programsMap = await getProgramAssociationsBatch(projectIds);
 * for (const project of projects) {
 *   project.program = programsMap.get(project.id) || null;
 * }
 */
export async function getProgramAssociationsBatch(
  documentIds: string[]
): Promise<Map<string, BelongsTo>> {
  if (documentIds.length === 0) {
    return new Map();
  }

  const result = await pool.query<BatchBelongsToRow>(
    `SELECT da.document_id, da.related_id as id, da.relationship_type as type,
            d.title, d.properties->>'color' as color
     FROM document_associations da
     LEFT JOIN documents d ON da.related_id = d.id
     WHERE da.document_id = ANY($1) AND da.relationship_type = 'program'`,
    [documentIds]
  );

  const programsMap = new Map<string, BelongsTo>();
  for (const row of result.rows) {
    programsMap.set(row.document_id, extractBelongsToFromRow(row));
  }

  return programsMap;
}

// =============================================================================
// User Lookup
// =============================================================================

/**
 * Get basic user info for response formatting
 *
 * @example
 * const user = await getUserInfo(userId);
 * // Returns: { id: '...', name: 'John', email: 'john@example.com' }
 */
export async function getUserInfo(
  userId: string | null
): Promise<{ id: string; name: string; email: string } | null> {
  if (!userId) return null;

  const result = await pool.query<UserRow>(
    'SELECT id, name, email FROM users WHERE id = $1',
    [userId]
  );

  if (result.rows.length === 0) return null;

  const row = result.rows[0];
  if (!row) return null;

  return {
    id: row.id,
    name: row.name,
    email: row.email,
  };
}

/**
 * Batch get user info to avoid N+1 queries
 *
 * @example
 * const usersMap = await getUserInfoBatch(userIds);
 * for (const item of items) {
 *   item.owner = usersMap.get(item.owner_id) || null;
 * }
 */
export async function getUserInfoBatch(
  userIds: string[]
): Promise<Map<string, { id: string; name: string; email: string }>> {
  const uniqueIds = [...new Set(userIds.filter(Boolean))];
  if (uniqueIds.length === 0) {
    return new Map();
  }

  const result = await pool.query<UserRow>(
    'SELECT id, name, email FROM users WHERE id = ANY($1)',
    [uniqueIds]
  );

  const usersMap = new Map<string, { id: string; name: string; email: string }>();
  for (const row of result.rows) {
    usersMap.set(row.id, {
      id: row.id,
      name: row.name,
      email: row.email,
    });
  }

  return usersMap;
}

// =============================================================================
// Document History Queries
// =============================================================================

/**
 * History entry for a tracked document field
 */
export interface DocumentFieldHistoryEntry {
  id: number;
  documentId: string;
  field: string;
  oldValue: string | null;
  newValue: string | null;
  changedBy: string | null;
  changedByName?: string;
  changedByEmail?: string;
  automatedBy: string | null;
  createdAt: Date;
}

/**
 * Get the change history for a specific field on a document
 *
 * Returns all changes to the field in chronological order (oldest first).
 * Includes user info for who made each change.
 *
 * @example
 * const history = await getDocumentFieldHistory(sprintId, 'hypothesis');
 * // Returns array of { id, oldValue, newValue, changedBy, createdAt, ... }
 */
export async function getDocumentFieldHistory(
  documentId: string,
  field: string
): Promise<DocumentFieldHistoryEntry[]> {
  const result = await pool.query<DocumentFieldHistoryRow>(
    `SELECT dh.id, dh.document_id, dh.field, dh.old_value, dh.new_value,
            dh.changed_by, dh.automated_by, dh.created_at,
            u.name as changed_by_name, u.email as changed_by_email
     FROM document_history dh
     LEFT JOIN users u ON dh.changed_by = u.id
     WHERE dh.document_id = $1 AND dh.field = $2
     ORDER BY dh.created_at ASC`,
    [documentId, field]
  );

  return result.rows.map(extractFieldHistoryFromRow);
}

/**
 * Get the most recent history entry for a specific field on a document
 *
 * Useful for finding the last approved version of a field.
 *
 * @example
 * const lastChange = await getLatestDocumentFieldHistory(sprintId, 'hypothesis');
 */
export async function getLatestDocumentFieldHistory(
  documentId: string,
  field: string
): Promise<DocumentFieldHistoryEntry | null> {
  const result = await pool.query<DocumentFieldHistoryRow>(
    `SELECT dh.id, dh.document_id, dh.field, dh.old_value, dh.new_value,
            dh.changed_by, dh.automated_by, dh.created_at,
            u.name as changed_by_name, u.email as changed_by_email
     FROM document_history dh
     LEFT JOIN users u ON dh.changed_by = u.id
     WHERE dh.document_id = $1 AND dh.field = $2
     ORDER BY dh.created_at DESC
     LIMIT 1`,
    [documentId, field]
  );

  if (result.rows.length === 0) return null;

  const row = result.rows[0];
  if (!row) return null;
  return extractFieldHistoryFromRow(row);
}
