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
      kind: 'setup';
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
    return {
      kind: 'api_token',
      tokenId: req.apiTokenId ?? 'unknown-token',
      userId: req.userId,
      workspaceId: req.workspaceId,
      isSuperAdmin: req.isSuperAdmin === true,
      scopes: req.apiTokenScopes,
    };
  }

  return {
    kind: 'session',
    sessionId: req.sessionId ?? 'unknown-session',
    userId: req.userId,
    workspaceId: req.workspaceId,
    isSuperAdmin: req.isSuperAdmin === true,
  };
}
