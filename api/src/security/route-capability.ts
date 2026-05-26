// Route capability helpers centralize document ID guards and authorization responses.
import type { Request, Response } from 'express';
import { pool } from '../db/client.js';
import {
  authorize,
  capabilityDenialStatus,
  type Capability,
  type CapabilityDecision,
  type DocumentCapabilityAction,
  type DocumentCapabilityEnforce,
} from './capabilities.js';
import { principalFromRequest } from './principal.js';
import type { DocumentType } from '@ship/shared';

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

export async function requireDocument(
  req: Request,
  res: Response,
  input: {
    type: DocumentType;
    action: DocumentCapabilityAction;
    id: string;
    enforce?: DocumentCapabilityEnforce;
    notFoundMessage?: string;
  }
): Promise<CapabilityDecision | null> {
  return requireDocumentCapability(
    req,
    res,
    {
      resource: 'document',
      action: input.action,
      documentId: input.id,
      expectedType: input.type,
      ...(input.enforce ? { enforce: input.enforce } : {}),
    },
    input.notFoundMessage ?? 'Not found'
  );
}

export async function requireIssueRead(
  req: Request,
  res: Response,
  issueId: string
): Promise<CapabilityDecision | null> {
  return requireDocument(req, res, { type: 'issue', action: 'read', id: issueId, notFoundMessage: 'Issue not found' });
}

export async function requireProjectRead(
  req: Request,
  res: Response,
  projectId: string
): Promise<CapabilityDecision | null> {
  return requireDocument(req, res, { type: 'project', action: 'read', id: projectId, notFoundMessage: 'Project not found' });
}

export async function requireProgramRead(
  req: Request,
  res: Response,
  programId: string
): Promise<CapabilityDecision | null> {
  return requireDocument(req, res, { type: 'program', action: 'read', id: programId, notFoundMessage: 'Program not found' });
}

export async function requireSprintRead(
  req: Request,
  res: Response,
  sprintId: string
): Promise<CapabilityDecision | null> {
  return requireDocument(req, res, { type: 'sprint', action: 'read', id: sprintId, notFoundMessage: 'Week not found' });
}

export async function requireSprintWrite(
  req: Request,
  res: Response,
  sprintId: string
): Promise<CapabilityDecision | null> {
  return requireDocument(req, res, { type: 'sprint', action: 'write', id: sprintId, notFoundMessage: 'Week not found' });
}

export async function requireIssueWrite(
  req: Request,
  res: Response,
  issueId: string,
  enforce?: 'creator_or_admin'
): Promise<CapabilityDecision | null> {
  return requireDocument(req, res, { type: 'issue', action: 'write', id: issueId, enforce, notFoundMessage: 'Issue not found' });
}

export async function requirePersonRead(
  req: Request,
  res: Response,
  personId: string
): Promise<CapabilityDecision | null> {
  return requireDocument(req, res, { type: 'person', action: 'read', id: personId, notFoundMessage: 'Person not found' });
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
