import type { Request, Response } from 'express';
import { guardDocumentIdParam, guardSprintAccess } from '../../security/route-capability.js';

export function parseWeekId(req: Request, res: Response): string | null {
  return guardDocumentIdParam(res, req.params.id, 'Week not found');
}

export async function requireWeekRead(
  req: Request,
  res: Response,
  rawId: string | string[] | undefined
): Promise<string | null> {
  return guardSprintAccess(req, res, rawId, 'read');
}

export async function requireWeekWrite(
  req: Request,
  res: Response,
  rawId: string | string[] | undefined
): Promise<string | null> {
  return guardSprintAccess(req, res, rawId, 'write');
}
