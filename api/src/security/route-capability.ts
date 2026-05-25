import type { Request, Response } from 'express';
import { pool } from '../db/client.js';
import {
  authorize,
  capabilityDenialStatus,
  type Capability,
  type CapabilityDecision,
} from './capabilities.js';
import { principalFromRequest } from './principal.js';

const DOCUMENT_ID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isDocumentIdParam(value: string): boolean {
  return DOCUMENT_ID_REGEX.test(value);
}

export function guardDocumentIdParam(
  res: Response,
  rawId: string | string[] | undefined,
  notFoundMessage: string
): string | null {
  if (typeof rawId !== 'string' || !isDocumentIdParam(rawId)) {
    res.status(404).json({ error: notFoundMessage });
    return null;
  }
  return rawId;
}

export function authorizeRequest(req: Request, capability: Capability): Promise<CapabilityDecision> {
  return authorize(pool, principalFromRequest(req), capability);
}

/** Legacy route JSON shape (`{ error: string }`) used by issues/projects/programs handlers. */
export function respondLegacyCapabilityDenied(
  res: Response,
  decision: CapabilityDecision,
  notFoundMessage = 'Not found'
): void {
  const status = capabilityDenialStatus(decision.reason);
  res.status(status).json({
    error: status === 404 ? notFoundMessage : 'Forbidden',
  });
}

export async function requireDocumentCapability(
  req: Request,
  res: Response,
  capability: Extract<Capability, { resource: 'document' }>,
  notFoundMessage = 'Not found'
): Promise<CapabilityDecision | null> {
  const decision = await authorizeRequest(req, capability);
  if (!decision.allowed) {
    respondLegacyCapabilityDenied(res, decision, notFoundMessage);
    return null;
  }
  return decision;
}

export async function requireIssueRead(
  req: Request,
  res: Response,
  issueId: string
): Promise<CapabilityDecision | null> {
  return requireDocumentCapability(
    req,
    res,
    { resource: 'document', action: 'read', documentId: issueId, expectedType: 'issue' },
    'Issue not found'
  );
}

export async function requireProjectRead(
  req: Request,
  res: Response,
  projectId: string
): Promise<CapabilityDecision | null> {
  return requireDocumentCapability(
    req,
    res,
    { resource: 'document', action: 'read', documentId: projectId, expectedType: 'project' },
    'Project not found'
  );
}

export async function requireProgramRead(
  req: Request,
  res: Response,
  programId: string
): Promise<CapabilityDecision | null> {
  return requireDocumentCapability(
    req,
    res,
    { resource: 'document', action: 'read', documentId: programId, expectedType: 'program' },
    'Program not found'
  );
}

export async function requireSprintRead(
  req: Request,
  res: Response,
  sprintId: string
): Promise<CapabilityDecision | null> {
  return requireDocumentCapability(
    req,
    res,
    { resource: 'document', action: 'read', documentId: sprintId, expectedType: 'sprint' },
    'Week not found'
  );
}

export async function requireSprintWrite(
  req: Request,
  res: Response,
  sprintId: string
): Promise<CapabilityDecision | null> {
  return requireDocumentCapability(
    req,
    res,
    { resource: 'document', action: 'write', documentId: sprintId, expectedType: 'sprint' },
    'Week not found'
  );
}

export async function requireIssueWrite(
  req: Request,
  res: Response,
  issueId: string,
  enforce?: 'creator_or_admin'
): Promise<CapabilityDecision | null> {
  return requireDocumentCapability(
    req,
    res,
    {
      resource: 'document',
      action: 'write',
      documentId: issueId,
      expectedType: 'issue',
      ...(enforce ? { enforce } : {}),
    },
    'Issue not found'
  );
}

export async function requirePersonRead(
  req: Request,
  res: Response,
  personId: string
): Promise<CapabilityDecision | null> {
  return requireDocumentCapability(
    req,
    res,
    { resource: 'document', action: 'read', documentId: personId, expectedType: 'person' },
    'Person not found'
  );
}

export async function guardSprintAccess(
  req: Request,
  res: Response,
  rawId: string | string[] | undefined,
  action: 'read' | 'write'
): Promise<string | null> {
  const id = guardDocumentIdParam(res, rawId, 'Week not found');
  if (!id) return null;
  const decision =
    action === 'read' ? await requireSprintRead(req, res, id) : await requireSprintWrite(req, res, id);
  return decision ? id : null;
}
