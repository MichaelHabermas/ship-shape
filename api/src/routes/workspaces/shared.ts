import { z } from 'zod';
export type WorkspaceRow = {
  id: string;
  name: string;
  sprint_start_date: Date | string | null;
  archived_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

export type WorkspaceListRow = WorkspaceRow & {
  role?: string | null;
};

export type UserSuperAdminRow = {
  is_super_admin: boolean;
};

export type IdRow = {
  id: string;
};

export type WorkspaceSwitchRow = {
  id: string;
  name: string;
  archived_at: Date | null;
};

export type ActiveMemberRow = {
  id: string;
  user_id: string;
  role: string;
  created_at: Date;
  email: string;
  name: string;
  person_document_id: string | null;
  is_archived: boolean;
};

export type ArchivedMemberRow = {
  person_document_id: string;
  user_id: string | null;
  archived_at: Date | null;
  email: string | null;
  name: string | null;
  is_archived: boolean;
};

export type UserRow = {
  id: string;
  email: string;
  name: string;
};

export type MembershipCreatedRow = {
  id: string;
  created_at: Date;
};

export type RoleRow = {
  role: string;
};

export type CountRow = {
  count: string | number;
};

export type MembershipUpdatedRow = {
  id: string;
  role: string;
};

export type PersonDocRow = {
  id: string;
  title: string;
  properties: Record<string, unknown> | null;
  archived_at: Date | null;
};

export type InviteListRow = {
  id: string;
  email: string;
  token: string;
  role: string;
  expires_at: Date;
  created_at: Date;
  invited_by_name: string;
};

export type InviteCreatedRow = {
  id: string;
  email: string;
  x509_subject_dn: string | null;
  role: string;
  expires_at: Date;
  created_at: Date;
};

export type AuditLogRow = {
  id: string;
  action: string;
  resource_type: string;
  resource_id: string | null;
  details: Record<string, unknown> | null;
  ip_address: string | null;
  user_agent: string | null;
  created_at: Date;
  actor_email: string;
  actor_name: string;
  impersonating_email: string | null;
};

export type MutationRow = Record<string, never>;

export type WorkspaceMemberResponse = {
  id: string;
  userId: string | null;
  email: string | null;
  name: string | null;
  role: string | null;
  personDocumentId: string | null;
  joinedAt: Date | string | null;
  isArchived: boolean;
};

export function toCount(value: string | number): number {
  return typeof value === 'number' ? value : Number(value);
}

export function requireFirstRow<T>(rows: T[]): T {
  const row = rows[0];
  if (!row) {
    throw new Error('Expected query to return a row');
  }
  return row;
}

export function mapWorkspaceListItem(row: WorkspaceListRow) {
  return {
    id: row.id,
    name: row.name,
    sprintStartDate: row.sprint_start_date,
    archivedAt: row.archived_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    role: row.role,
  };
}

export function mapSuperAdminWorkspaceItem(row: WorkspaceRow) {
  return {
    id: row.id,
    name: row.name,
    sprintStartDate: row.sprint_start_date,
    archivedAt: row.archived_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    role: 'admin' as const,
    isSuperAdmin: true,
  };
}

export function mapCurrentWorkspace(row: WorkspaceListRow) {
  return {
    id: row.id,
    name: row.name,
    sprintStartDate: row.sprint_start_date,
    archivedAt: row.archived_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    role: row.role || 'admin',
  };
}

export function mapActiveMember(row: ActiveMemberRow): WorkspaceMemberResponse {
  return {
    id: row.id,
    userId: row.user_id,
    email: row.email,
    name: row.name,
    role: row.role,
    personDocumentId: row.person_document_id,
    joinedAt: row.created_at,
    isArchived: false,
  };
}

export function mapArchivedMember(row: ArchivedMemberRow): WorkspaceMemberResponse {
  return {
    id: row.person_document_id,
    userId: row.user_id,
    email: row.email,
    name: row.name,
    role: null,
    personDocumentId: row.person_document_id,
    joinedAt: null,
    isArchived: true,
  };
}

export function mapCreatedMembership(
  membership: MembershipCreatedRow,
  user: UserRow,
  userId: string,
  role: string,
  personDocumentId: string,
) {
  return {
    id: membership.id,
    userId,
    email: user.email,
    name: user.name,
    role,
    personDocumentId,
    createdAt: membership.created_at,
  };
}

export function mapDirectAddMember(user: UserRow, role: string) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role,
  };
}

export function mapInvite(row: InviteListRow) {
  return {
    id: row.id,
    email: row.email,
    token: row.token,
    role: row.role,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    invitedByName: row.invited_by_name,
  };
}

export function mapCreatedInvite(row: InviteCreatedRow, token: string) {
  return {
    id: row.id,
    email: row.email,
    x509SubjectDn: row.x509_subject_dn,
    role: row.role,
    token,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  };
}

export function mapAuditLog(row: AuditLogRow) {
  return {
    id: row.id,
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

export function getQueryString(value: unknown, fallback: string): string {
  if (Array.isArray(value)) {
    const firstValue: unknown = value[0];
    return typeof firstValue === 'string' ? firstValue : fallback;
  }

  return typeof value === 'string' ? value : fallback;
}

export const createInviteBodySchema = z.object({
  email: z.string().min(1),
  x509SubjectDn: z.string().optional(),
  role: z.enum(['admin', 'member']).optional(),
});

