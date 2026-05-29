import type { Principal } from './principal.js';

export interface DocumentActor {
  userId: string;
  workspaceId: string;
  isSuperAdmin: boolean;
}

export function documentActorFromPrincipal(principal: Principal): DocumentActor {
  if (principal.kind === 'setup' || principal.kind === 'fleetgraph_system') {
    throw new Error('Principal cannot be converted to DocumentActor');
  }
  return {
    userId: principal.userId,
    workspaceId: principal.workspaceId,
    isSuperAdmin: principal.isSuperAdmin,
  };
}
