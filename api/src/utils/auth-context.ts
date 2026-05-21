import type { Request } from 'express';

export type AuthenticatedRouteContext = {
  userId: string;
  workspaceId: string;
  isSuperAdmin: boolean;
};

export function getAuthenticatedRouteContext(req: Request): AuthenticatedRouteContext {
  if (!req.userId || !req.workspaceId) {
    throw new Error('Authenticated route is missing user or workspace context');
  }

  return {
    userId: req.userId,
    workspaceId: req.workspaceId,
    isSuperAdmin: req.isSuperAdmin === true,
  };
}
