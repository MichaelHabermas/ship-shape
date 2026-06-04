export type EmptyRow = Record<string, never>;

export type WorkspaceRow = {
  id: string;
  name: string;
  sprint_start_date: string | Date | null;
  archived_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

export type WorkspaceListRow = WorkspaceRow & {
  member_count: string | number;
};

export type IdRow = { id: string };

export type WorkspaceNameRow = {
  id: string;
  name: string;
};

export type UserWorkspaceJson = {
  id: string;
  name: string;
  role: string;
};

export type UserListRow = {
  id: string;
  email: string;
  name: string;
  is_super_admin: boolean;
  created_at: Date;
  workspaces: UserWorkspaceJson[];
};

export type UserBasicRow = {
  id: string;
  email: string;
  name: string;
};

export type UserSuperAdminRow = {
  id: string;
  is_super_admin: boolean;
};

export type AuditLogRow = {
  id: string;
  workspace_id: string | null;
  action: string;
  resource_type: string | null;
  resource_id: string | null;
  details: Record<string, unknown> | null;
  ip_address: string | null;
  user_agent: string | null;
  created_at: Date;
  actor_email: string;
  actor_name: string;
  impersonating_email: string | null;
  workspace_name: string | null;
};

export type AuditLogExportRow = {
  created_at: Date;
  workspace_name: string | null;
  actor_email: string;
  impersonating_email: string | null;
  action: string;
  resource_type: string | null;
  resource_id: string | null;
  details: Record<string, unknown> | null;
  ip_address: string | null;
};

export type WorkspaceMemberRow = {
  user_id: string;
  role: string;
  email: string;
  name: string;
};

export type WorkspaceInviteRow = {
  id: string;
  email: string;
  role: string;
  token: string;
  created_at: Date;
};

export type WorkspaceInviteCreateRow = {
  id: string;
  email: string;
  x509_subject_dn: string | null;
  role: string;
  token: string;
  created_at: Date;
};

export type InviteRevokeRow = {
  id: string;
  email: string;
};

export type MemberRoleRow = {
  role: string;
  email: string;
};

export type CountRow = {
  count: string | number;
};

export type MembershipRow = {
  id: string;
  created_at: Date;
};

export type DebugUserRow = {
  id: string;
  email: string;
  name: string;
  x509_subject_dn: string | null;
  is_super_admin: boolean;
  last_auth_provider: string | null;
  last_workspace_id: string | null;
  created_at: Date;
  updated_at: Date;
  email_lower: string;
  membership_count: string | number;
  session_count: string | number;
};

export type DebugMembershipRow = {
  user_id: string;
  workspace_id: string;
  role: string;
  workspace_name: string;
  archived_at: Date | null;
};

export type DanglingAssociationRow = {
  association_id: string;
  document_id: string;
  related_id: string;
  relationship_type: string;
  document_title: string;
  document_type: string;
  workspace_name: string;
};

export type OrphanDocumentRow = {
  id: string;
  title: string;
  workspace_name: string;
  created_at: Date;
  sprint_status?: string | null;
  state?: string | null;
};

export type DeleteDanglingRow = {
  id: string;
};

export function toNumber(value: string | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  return typeof value === 'number' ? value : Number(value);
}

export function requireFirstRow<T>(rows: T[]): T {
  const row = rows[0];
  if (!row) {
    throw new Error('Expected query to return a row');
  }
  return row;
}

export function mapWorkspace(row: WorkspaceRow) {
  return {
    id: row.id,
    name: row.name,
    sprintStartDate: row.sprint_start_date,
    archivedAt: row.archived_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapWorkspaceListItem(row: WorkspaceListRow) {
  return {
    ...mapWorkspace(row),
    memberCount: toNumber(row.member_count),
  };
}

export function mapUserListItem(row: UserListRow) {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    isSuperAdmin: row.is_super_admin,
    createdAt: row.created_at,
    workspaces: row.workspaces,
  };
}

export function mapUserBasic(row: UserBasicRow) {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
  };
}

export function mapAuditLog(row: AuditLogRow) {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    workspaceName: row.workspace_name,
    action: row.action,
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    details: row.details,
    ipAddress: row.ip_address,
    userAgent: row.user_agent,
    createdAt: row.created_at,
    actorEmail: row.actor_email,
    actorName: row.actor_name,
    impersonatingEmail: row.impersonating_email,
  };
}

export function mapWorkspaceMember(row: WorkspaceMemberRow) {
  return {
    userId: row.user_id,
    email: row.email,
    name: row.name,
    role: row.role,
  };
}

export function mapWorkspaceInvite(row: WorkspaceInviteRow) {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    token: row.token,
    createdAt: row.created_at,
  };
}

export function mapWorkspaceInviteCreated(row: WorkspaceInviteCreateRow) {
  return {
    id: row.id,
    email: row.email,
    x509SubjectDn: row.x509_subject_dn,
    role: row.role,
    token: row.token,
    createdAt: row.created_at,
  };
}