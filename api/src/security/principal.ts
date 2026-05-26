// Principal types describe authenticated actors for capability authorization.
import type { Request } from 'express';

export type ApiTokenScope =
  | 'legacy:full'
  | 'documents:read'
  | 'documents:write'
  | 'documents:content'
  | 'documents:governance'
  | 'files:read'
  | 'files:write'
  | 'collaboration:join'
  | 'admin:workspace';

export type Principal =
  | {
      kind: 'session';
      sessionId: string;
      userId: string;
      workspaceId: string;
      isSuperAdmin: boolean;
    }
  | {
      kind: 'api_token';
      tokenId: string;
      userId: string;
      workspaceId: string;
      isSuperAdmin: boolean;
      scopes: ApiTokenScope[];
    }
  | {
      kind: 'fleetgraph_system';
      workspaceId: string;
      isSuperAdmin: false;
      userId?: never;
    }
  | {
      kind: 'setup';
      userId?: never;
    };

declare global {
  namespace Express {
    interface Request {
      principal?: Principal;
      apiTokenScopes?: ApiTokenScope[];
    }
  }
}

export function principalFromRequest(req: Request): Principal {
  if (req.principal) return req.principal;

  if (!req.userId || !req.workspaceId) {
    throw new Error('Authenticated route is missing principal context');
  }

  if (req.isApiToken) {
    if (!req.apiTokenScopes) {
      throw new Error('API token route is missing token scope context');
    }
    if (!req.apiTokenId) {
      throw new Error('API token route is missing token id');
    }
    return {
      kind: 'api_token',
      tokenId: req.apiTokenId,
      userId: req.userId,
      workspaceId: req.workspaceId,
      isSuperAdmin: req.isSuperAdmin === true,
      scopes: req.apiTokenScopes,
    };
  }

  if (!req.sessionId) {
    throw new Error('Session route is missing session id');
  }

  return {
    kind: 'session',
    sessionId: req.sessionId,
    userId: req.userId,
    workspaceId: req.workspaceId,
    isSuperAdmin: req.isSuperAdmin === true,
  };
}
