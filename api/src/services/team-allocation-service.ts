/** Assigns people to sprint documents and resolves workspace person records for team allocation. */
import { pool } from '../db/client.js';
import { VISIBILITY_FILTER_SQL } from '../middleware/visibility.js';
import type { EmptyRow, IdRow, ProjectWithProgramRow, SprintDocumentRow } from '../routes/team/types.js';

export type TeamAllocationResult<T> =
  | { ok: true; status: number; body: T }
  | { ok: false; status: number; body: Record<string, unknown> };

export type AssignTeamMemberInput = {
  workspaceId: string;
  personId?: string;
  userId?: string;
  projectId?: string;
  programId?: string;
  sprintNumber: number;
};

export async function assignTeamMember(
  input: AssignTeamMemberInput
): Promise<TeamAllocationResult<{ success: true; sprintId: string }>> {
  const { workspaceId, personId, userId, projectId, programId, sprintNumber } = input;
  const ownerId = personId || userId;
  const assignmentId = projectId || programId;
  const isProjectAssignment = !!projectId;

  if (!ownerId || !assignmentId || !sprintNumber) {
    return { ok: false, status: 400, body: { error: 'Missing required fields' } };
  }

  let personDocId = personId;
  if (personId) {
    const personCheck = await pool.query<IdRow>(
      `SELECT id FROM documents
       WHERE id = $1 AND workspace_id = $2 AND document_type = 'person'`,
      [personId, workspaceId]
    );
    if (!personCheck.rows[0]) {
      return { ok: false, status: 400, body: { error: 'Invalid personId for this workspace' } };
    }
  } else if (userId) {
    const personResult = await pool.query<IdRow>(
      `SELECT id FROM documents
       WHERE workspace_id = $1 AND document_type = 'person'
         AND properties->>'user_id' = $2 AND archived_at IS NULL`,
      [workspaceId, userId]
    );
    if (personResult.rows[0]) {
      personDocId = personResult.rows[0].id;
    } else {
      return { ok: false, status: 400, body: { error: 'Invalid userId for this workspace' } };
    }
  }

  let resolvedProgramId: string | null = null;
  let resolvedProjectId: string | null = null;

  if (isProjectAssignment) {
    const projectCheck = await pool.query<ProjectWithProgramRow>(
      `SELECT d.id, prog_da.related_id as program_id
       FROM documents d
       LEFT JOIN document_associations prog_da ON d.id = prog_da.document_id AND prog_da.relationship_type = 'program'
       WHERE d.id = $1 AND d.workspace_id = $2 AND d.document_type = 'project'`,
      [projectId, workspaceId]
    );
    if (!projectCheck.rows[0]) {
      return { ok: false, status: 400, body: { error: 'Invalid projectId for this workspace' } };
    }
    resolvedProjectId = projectId ?? null;
    resolvedProgramId = projectCheck.rows[0].program_id;
  } else {
    const programCheck = await pool.query<IdRow>(
      `SELECT id FROM documents
       WHERE id = $1 AND workspace_id = $2 AND document_type = 'program'`,
      [programId, workspaceId]
    );
    if (!programCheck.rows[0]) {
      return { ok: false, status: 400, body: { error: 'Invalid programId for this workspace' } };
    }
    resolvedProgramId = programId ?? null;
  }

  const existingAssignment = await pool.query<IdRow>(
    `SELECT s.id
     FROM documents s
     WHERE s.workspace_id = $1 AND s.document_type = 'sprint'
       AND s.properties->'assignee_ids' ? $2
       AND (s.properties->>'sprint_number')::int = $3
       AND s.properties->>'project_id' = $4
       AND ($5::uuid IS NULL AND NOT EXISTS (SELECT 1 FROM document_associations WHERE document_id = s.id AND relationship_type = 'program') OR s.id IN (SELECT document_id FROM document_associations WHERE related_id = $5 AND relationship_type = 'program'))`,
    [workspaceId, personDocId, sprintNumber, resolvedProjectId, resolvedProgramId]
  );

  if (existingAssignment.rows[0]) {
    return { ok: true, status: 200, body: { success: true, sprintId: existingAssignment.rows[0].id } };
  }

  const conflictingSprints = await pool.query<SprintDocumentRow>(
    `SELECT id, properties FROM documents
     WHERE workspace_id = $1 AND document_type = 'sprint'
       AND (properties->>'sprint_number')::int = $2
       AND properties->'assignee_ids' @> to_jsonb($3::text)
       AND (properties->>'project_id' IS DISTINCT FROM $4)`,
    [workspaceId, sprintNumber, personDocId, resolvedProjectId]
  );

  for (const conflicting of conflictingSprints.rows) {
    const props = conflicting.properties || {};
    const assignees: string[] = (props.assignee_ids || []).filter((id: string) => id !== personDocId);
    await pool.query<EmptyRow>(
      `UPDATE documents SET properties = jsonb_set(properties, '{assignee_ids}', $1::jsonb), updated_at = now() WHERE id = $2`,
      [JSON.stringify(assignees), conflicting.id]
    );
  }

  const sprintResult = await pool.query<SprintDocumentRow>(
    `SELECT id, properties FROM documents
     WHERE workspace_id = $1 AND document_type = 'sprint'
       AND ($2::uuid IS NULL AND NOT EXISTS (SELECT 1 FROM document_associations WHERE document_id = documents.id AND relationship_type = 'program') OR id IN (SELECT document_id FROM document_associations WHERE related_id = $2 AND relationship_type = 'program'))
       AND (properties->>'sprint_number')::int = $3
       AND properties->>'project_id' = $4`,
    [workspaceId, resolvedProgramId, sprintNumber, resolvedProjectId]
  );

  let sprintId: string;
  if (sprintResult.rows[0]) {
    sprintId = sprintResult.rows[0].id;
    const currentProps = sprintResult.rows[0].properties || {};
    const currentAssignees: string[] = currentProps.assignee_ids || [];
    if (personDocId && !currentAssignees.includes(personDocId)) {
      currentAssignees.push(personDocId);
    }
    const updatedProps = { ...currentProps, assignee_ids: currentAssignees };
    await pool.query<EmptyRow>(
      `UPDATE documents SET properties = $1, updated_at = now() WHERE id = $2`,
      [JSON.stringify(updatedProps), sprintId]
    );
  } else {
    const props: Record<string, unknown> = {
      sprint_number: sprintNumber,
      assignee_ids: [personDocId],
    };
    if (resolvedProjectId) {
      props.project_id = resolvedProjectId;
    }

    const newSprintResult = await pool.query<IdRow>(
      `INSERT INTO documents (workspace_id, document_type, title, properties)
       VALUES ($1, 'sprint', $2, $3)
       RETURNING id`,
      [workspaceId, `Week ${sprintNumber}`, JSON.stringify(props)]
    );
    const createdSprint = newSprintResult.rows[0];
    if (!createdSprint) {
      throw new Error('Failed to create sprint');
    }
    sprintId = createdSprint.id;

    await pool.query<EmptyRow>(
      `INSERT INTO document_associations (document_id, related_id, relationship_type)
       VALUES ($1, $2, 'program')`,
      [sprintId, resolvedProgramId]
    );
  }

  return { ok: true, status: 200, body: { success: true, sprintId } };
}

export type UnassignTeamMemberInput = {
  workspaceId: string;
  currentUserId: string;
  isAdmin: boolean;
  personId?: string;
  userId?: string;
  sprintNumber: number;
};

export async function unassignTeamMember(
  input: UnassignTeamMemberInput
): Promise<TeamAllocationResult<{ success: true }>> {
  const { workspaceId, currentUserId, isAdmin, personId, userId, sprintNumber } = input;
  const ownerId = personId || userId;

  if (!ownerId || !sprintNumber) {
    return { ok: false, status: 400, body: { error: 'Missing required fields' } };
  }

  let personDocId = personId;
  if (personId) {
    const personCheck = await pool.query<IdRow>(
      `SELECT id FROM documents
       WHERE id = $1 AND workspace_id = $2 AND document_type = 'person'`,
      [personId, workspaceId]
    );
    if (!personCheck.rows[0]) {
      return { ok: false, status: 400, body: { error: 'Invalid personId for this workspace' } };
    }
  } else if (userId) {
    const personResult = await pool.query<IdRow>(
      `SELECT id FROM documents
       WHERE workspace_id = $1 AND document_type = 'person'
         AND properties->>'user_id' = $2 AND archived_at IS NULL`,
      [workspaceId, userId]
    );
    if (personResult.rows[0]) {
      personDocId = personResult.rows[0].id;
    } else {
      return { ok: false, status: 400, body: { error: 'Invalid userId for this workspace' } };
    }
  }

  const sprintResult = await pool.query<SprintDocumentRow>(
    `SELECT id, properties FROM documents
     WHERE workspace_id = $1 AND document_type = 'sprint'
       AND properties->'assignee_ids' ? $2
       AND (properties->>'sprint_number')::int = $3
       AND ${VISIBILITY_FILTER_SQL('documents', '$4', '$5')}`,
    [workspaceId, personDocId, sprintNumber, currentUserId, isAdmin]
  );

  if (!sprintResult.rows[0]) {
    return { ok: false, status: 404, body: { error: 'No assignment found' } };
  }

  const sprintId = sprintResult.rows[0].id;
  const currentProps = sprintResult.rows[0].properties || {};
  const currentAssignees: string[] = currentProps.assignee_ids || [];
  const updatedAssignees = currentAssignees.filter((id: string) => id !== personDocId);

  const updatedProps = { ...currentProps, assignee_ids: updatedAssignees };
  await pool.query<EmptyRow>(
    `UPDATE documents SET properties = $1, updated_at = now() WHERE id = $2`,
    [JSON.stringify(updatedProps), sprintId]
  );

  return { ok: true, status: 200, body: { success: true } };
}
