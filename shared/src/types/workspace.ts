// Workspace types

export interface Workspace {
  id: string;
  name: string;
  sprintStartDate: Date;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface WorkspaceMembership {
  id: string;
  workspaceId: string;
  userId: string;
  personDocumentId: string | null;
  role: 'admin' | 'member';
  createdAt: Date;
  updatedAt: Date;
}

export interface WorkspaceInvite {
  id: string;
  workspaceId: string;
  email: string;
  token: string;
  role: 'admin' | 'member';
  invitedByUserId: string;
  expiresAt: Date;
  usedAt: Date | null;
  createdAt: Date;
}

export interface AuditLog {
  id: string;
  workspaceId: string | null;
  actorUserId: string;
  impersonatingUserId: string | null;
  action: string;
  resourceType: string | null;
  resourceId: string | null;
  details: Record<string, unknown> | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: Date;
}

// Response types
export interface WorkspaceWithRole extends Workspace {
  role: 'admin' | 'member';
  isSuperAdmin?: boolean;
}

export interface MemberWithUser {
  id: string;
  userId: string;
  email: string;
  name: string;
  role: 'admin' | 'member';
  personDocumentId: string | null;
  createdAt: Date;
}

/** Wire shape for workspace JSON from HTTP APIs (ISO date strings). */
export interface WorkspaceResponse {
  id: string;
  name: string;
  sprintStartDate?: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceMembershipResponse {
  id: string;
  workspaceId: string;
  userId: string;
  role: 'admin' | 'member';
  personDocumentId: string | null;
  createdAt: string;
}

export interface WorkspaceInviteResponse {
  id: string;
  workspaceId: string;
  email: string;
  x509SubjectDn?: string | null;
  token: string;
  role: 'admin' | 'member';
  expiresAt: string;
  createdAt: string;
}

export interface AuditLogResponse {
  id: string;
  workspaceId: string | null;
  actorUserId: string;
  actorName: string;
  actorEmail: string;
  impersonatingUserId: string | null;
  action: string;
  resourceType: string | null;
  resourceId: string | null;
  details: Record<string, unknown> | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
}

export interface WorkspaceMemberResponse {
  id: string;
  userId: string;
  email: string;
  name: string;
  role: 'admin' | 'member' | null;
  personDocumentId: string | null;
  joinedAt: string | null;
  isArchived?: boolean;
}

export interface WorkspaceWithRoleResponse extends WorkspaceResponse {
  role: 'admin' | 'member';
  isSuperAdmin?: boolean;
}
