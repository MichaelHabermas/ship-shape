// FleetGraph blast radius assembles read-only consequence maps from visible document relationships.
import type {
  FleetGraphBlastRadiusEdge,
  FleetGraphBlastRadiusNode,
  FleetGraphBlastRadiusResponse,
} from '@ship/shared';
import type { Pool, PoolClient } from 'pg';
import { pool } from '../db/client.js';
import { authorize } from '../security/capabilities.js';
import type { Principal } from '../security/principal.js';
import { visibleOutputForFinding } from './evidence.js';
import { fleetGraphFindingResponse } from './api-contract.js';
import {
  getFleetGraphFindingById,
  listFleetGraphFindingsForSource,
  type FleetGraphFinding,
} from './persistence.js';

type QueryRunner = Pick<Pool | PoolClient, 'query'>;

type DocumentNodeRow = {
  id: string;
  document_type: 'issue' | 'sprint' | 'project' | 'program';
  title: string;
  properties: Record<string, unknown> | null;
  relationship_type: 'source_issue' | 'source_sprint' | 'project' | 'program';
};

type PersonNodeRow = {
  id: string;
  title: string;
  role: 'assignee' | 'owner';
  person_document_id: string | null;
};

export async function getFleetGraphBlastRadius(input: {
  workspaceId: string;
  principal: Principal;
  findingId: string;
  db?: QueryRunner;
}): Promise<FleetGraphBlastRadiusResponse | null> {
  const db = input.db ?? pool;
  const finding = await getFleetGraphFindingById({
    workspaceId: input.workspaceId,
    findingId: input.findingId,
  }, db);
  if (!finding) return null;

  const { output } = await visibleOutputForFinding({
    principal: input.principal,
    workspaceId: input.workspaceId,
    finding,
    db,
  });
  if (output.noSafeOutput) return null;

  const nodes: FleetGraphBlastRadiusNode[] = [{
    id: nodeId('finding', finding.id),
    kind: 'finding',
    title: finding.title,
    subtitle: signalSummary(finding),
    status: finding.status,
    severity: finding.severity,
  }];
  const edges: FleetGraphBlastRadiusEdge[] = [];

  const documents = await visibleDocumentRows({
    workspaceId: input.workspaceId,
    principal: input.principal,
    finding,
    db,
  });
  for (const document of documents) {
    const kind = document.document_type;
    nodes.push({
      id: nodeId(kind, document.id),
      kind,
      title: document.title,
      subtitle: subtitleForDocument(document),
    });
    edges.push({
      from: nodeId('finding', finding.id),
      to: nodeId(kind, document.id),
      kind: document.relationship_type,
      label: edgeLabelForDocument(document.relationship_type),
    });
  }

  const people = await visiblePeopleRows({
    workspaceId: input.workspaceId,
    principal: input.principal,
    finding,
    db,
  });
  for (const person of people) {
    nodes.push({
      id: nodeId('person', person.id),
      kind: 'person',
      title: person.title,
      subtitle: person.role === 'assignee' ? 'Issue assignee' : 'Week owner',
    });
    edges.push({
      from: nodeId('finding', finding.id),
      to: nodeId('person', person.id),
      kind: person.role,
      label: person.role === 'assignee' ? 'assigned to' : 'owned by',
    });
  }

  const relatedFindings = await relatedOpenFindings({
    workspaceId: input.workspaceId,
    principal: input.principal,
    finding,
    db,
  });
  for (const related of relatedFindings) {
    nodes.push({
      id: nodeId('finding', related.id),
      kind: 'finding',
      title: related.title,
      subtitle: 'Related open finding',
      status: related.status,
      severity: related.severity,
    });
    edges.push({
      from: nodeId('finding', finding.id),
      to: nodeId('finding', related.id),
      kind: 'related_finding',
      label: 'same week',
    });
  }

  return {
    finding: fleetGraphFindingResponse({ ...finding, visibleOutput: output }),
    summary: blastRadiusSummary(nodes, relatedFindings.length),
    nodes: dedupeNodes(nodes),
    edges: dedupeEdges(edges),
  };
}

async function visibleDocumentRows(input: {
  workspaceId: string;
  principal: Principal;
  finding: FleetGraphFinding;
  db: QueryRunner;
}): Promise<DocumentNodeRow[]> {
  const result = await input.db.query<DocumentNodeRow>(
    `WITH anchors AS (
       SELECT $2::uuid AS id, 'source_issue'::text AS relationship_type
       UNION ALL
       SELECT $3::uuid AS id, 'source_sprint'::text AS relationship_type
       UNION ALL
       SELECT da.related_id AS id, da.relationship_type::text
         FROM document_associations da
        WHERE da.document_id = $2::uuid
          AND da.relationship_type IN ('project', 'program')
       UNION ALL
       SELECT da.related_id AS id, da.relationship_type::text
         FROM document_associations da
        WHERE da.document_id = $3::uuid
          AND da.relationship_type IN ('project', 'program')
     )
     SELECT DISTINCT d.id,
            d.document_type,
            d.title,
            d.properties,
            anchors.relationship_type
       FROM anchors
       JOIN documents d
         ON d.id = anchors.id
        AND d.workspace_id = $1
        AND d.deleted_at IS NULL
        AND d.archived_at IS NULL
        AND d.document_type IN ('issue', 'sprint', 'project', 'program')`,
    [input.workspaceId, input.finding.source_issue_id, input.finding.source_sprint_id]
  );

  const visible = await Promise.all(result.rows.map(async (row) => {
    const decision = await authorize(input.db, input.principal, {
      resource: 'document',
      action: 'read',
      documentId: row.id,
      expectedType: row.document_type,
    });
    return decision.allowed ? row : null;
  }));
  return visible.filter((row): row is DocumentNodeRow => row !== null);
}

async function visiblePeopleRows(input: {
  workspaceId: string;
  principal: Principal;
  finding: FleetGraphFinding;
  db: QueryRunner;
}): Promise<PersonNodeRow[]> {
  const result = await input.db.query<PersonNodeRow>(
    `WITH person_ids AS (
       SELECT issue.properties->>'assignee_id' AS id, 'assignee'::text AS role
         FROM documents issue
        WHERE issue.id = $2
          AND issue.workspace_id = $1
          AND issue.document_type = 'issue'
       UNION ALL
       SELECT sprint.properties->>'owner_id' AS id, 'owner'::text AS role
         FROM documents sprint
        WHERE sprint.id = $3
          AND sprint.workspace_id = $1
          AND sprint.document_type = 'sprint'
     )
     SELECT DISTINCT COALESCE(person.id, user_account.id)::text AS id,
            COALESCE(person.title, user_account.name) AS title,
            person_ids.role,
            person.id::text AS person_document_id
       FROM person_ids
       LEFT JOIN documents person
         ON (person.id = CASE
              WHEN person_ids.id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$'
              THEN person_ids.id::uuid
              ELSE NULL
            END
            OR person.properties->>'user_id' = person_ids.id)
        AND person.workspace_id = $1
        AND person.document_type = 'person'
        AND person.deleted_at IS NULL
        AND person.archived_at IS NULL
       LEFT JOIN users user_account
         ON user_account.id = CASE
              WHEN person_ids.id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$'
              THEN person_ids.id::uuid
              ELSE NULL
            END
      WHERE person_ids.id IS NOT NULL
        AND COALESCE(person.id::text, user_account.id::text) IS NOT NULL`,
    [input.workspaceId, input.finding.source_issue_id, input.finding.source_sprint_id]
  );

  const visible = await Promise.all(result.rows.map(async (row) => {
    if (!row.person_document_id) return row;
    const decision = await authorize(input.db, input.principal, {
      resource: 'document',
      action: 'read',
      documentId: row.person_document_id,
      expectedType: 'person',
    });
    return decision.allowed ? row : null;
  }));
  return visible.filter((row): row is PersonNodeRow => row !== null);
}

async function relatedOpenFindings(input: {
  workspaceId: string;
  principal: Principal;
  finding: FleetGraphFinding;
  db: QueryRunner;
}): Promise<FleetGraphFinding[]> {
  const findings = await listFleetGraphFindingsForSource({
    workspaceId: input.workspaceId,
    sourceSprintId: input.finding.source_sprint_id,
  }, input.db);
  const visible = await Promise.all(findings
    .filter((finding) => finding.id !== input.finding.id)
    .slice(0, 6)
    .map(async (finding) => {
      const { output } = await visibleOutputForFinding({
        principal: input.principal,
        workspaceId: input.workspaceId,
        finding,
        db: input.db,
      });
      return output.noSafeOutput ? null : finding;
    }));
  return visible.filter((finding): finding is FleetGraphFinding => finding !== null).slice(0, 3);
}

function nodeId(kind: FleetGraphBlastRadiusNode['kind'], id: string): string {
  return `${kind}:${id}`;
}

function signalSummary(finding: FleetGraphFinding): string {
  const signalType = typeof finding.run_metadata.signalType === 'string'
    ? finding.run_metadata.signalType
    : 'blocked';
  return `${signalType} / ${finding.severity}`;
}

function subtitleForDocument(document: DocumentNodeRow): string | undefined {
  if (document.document_type === 'issue') {
    const state = typeof document.properties?.state === 'string' ? document.properties.state : undefined;
    const priority = typeof document.properties?.priority === 'string' ? document.properties.priority : undefined;
    return [state, priority].filter(Boolean).join(' / ') || undefined;
  }
  return document.document_type === 'sprint' ? 'Week' : document.document_type;
}

function edgeLabelForDocument(type: DocumentNodeRow['relationship_type']): string {
  if (type === 'source_issue') return 'source issue';
  if (type === 'source_sprint') return 'scheduled in';
  if (type === 'project') return 'project impact';
  return 'program impact';
}

function blastRadiusSummary(nodes: FleetGraphBlastRadiusNode[], relatedFindingCount: number): string {
  const issue = nodes.find((node) => node.kind === 'issue')?.title ?? 'This finding';
  const projectCount = nodes.filter((node) => node.kind === 'project').length;
  const programCount = nodes.filter((node) => node.kind === 'program').length;
  const peopleCount = nodes.filter((node) => node.kind === 'person').length;
  const parts = [
    projectCount > 0 ? `${projectCount} project${projectCount === 1 ? '' : 's'}` : null,
    programCount > 0 ? `${programCount} program${programCount === 1 ? '' : 's'}` : null,
    peopleCount > 0 ? `${peopleCount} person${peopleCount === 1 ? '' : 's'}` : null,
    relatedFindingCount > 0 ? `${relatedFindingCount} related finding${relatedFindingCount === 1 ? '' : 's'}` : null,
  ].filter((part): part is string => part !== null);
  return parts.length > 0
    ? `${issue} touches ${parts.join(', ')}.`
    : `${issue} has no visible downstream blast radius yet.`;
}

function dedupeNodes(nodes: FleetGraphBlastRadiusNode[]): FleetGraphBlastRadiusNode[] {
  return [...new Map(nodes.map((node) => [node.id, node])).values()];
}

function dedupeEdges(edges: FleetGraphBlastRadiusEdge[]): FleetGraphBlastRadiusEdge[] {
  return [...new Map(edges.map((edge) => [`${edge.from}:${edge.to}:${edge.kind}`, edge])).values()];
}
