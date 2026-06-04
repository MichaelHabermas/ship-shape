// Admin API client owns super-admin workspace, user, audit, and impersonation calls.
import type { ApiResponse, AuditLogResponse, WorkspaceResponse } from '@ship/shared';

type ApiRequester = <T>(endpoint: string, options?: RequestInit) => Promise<ApiResponse<T>>;

type UserInfo = {
  id: string;
  email: string;
  name: string;
  isSuperAdmin: boolean;
};

export function createAdminApi(request: ApiRequester, apiUrl: string) {
  return {
    listWorkspaces: (includeArchived = false) =>
      request<{ workspaces: Array<WorkspaceResponse & { memberCount: number }> }>(`/api/admin/workspaces?archived=${includeArchived}`),

    createWorkspace: (data: { name: string }) =>
      request<{ workspace: WorkspaceResponse }>('/api/admin/workspaces', {
        method: 'POST',
        body: JSON.stringify(data),
      }),

    updateWorkspace: (workspaceId: string, data: { name?: string }) =>
      request<WorkspaceResponse>(`/api/admin/workspaces/${workspaceId}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),

    archiveWorkspace: (workspaceId: string) =>
      request<WorkspaceResponse>(`/api/admin/workspaces/${workspaceId}/archive`, {
        method: 'POST',
      }),

    getWorkspace: (workspaceId: string) =>
      request<{ workspace: WorkspaceResponse & { sprintStartDate: string | null } }>(`/api/admin/workspaces/${workspaceId}`),

    getWorkspaceMembers: (workspaceId: string) =>
      request<{ members: Array<{ userId: string; email: string; name: string; role: 'admin' | 'member' }> }>(`/api/admin/workspaces/${workspaceId}/members`),

    getWorkspaceInvites: (workspaceId: string) =>
      request<{ invites: Array<{ id: string; email: string; x509SubjectDn: string | null; role: 'admin' | 'member'; token: string; createdAt: string }> }>(`/api/admin/workspaces/${workspaceId}/invites`),

    createWorkspaceInvite: (workspaceId: string, data: { email: string; x509SubjectDn?: string; role?: 'admin' | 'member' }) =>
      request<{ invite: { id: string; email: string; x509SubjectDn: string | null; role: 'admin' | 'member'; token: string; createdAt: string } }>(`/api/admin/workspaces/${workspaceId}/invites`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),

    revokeWorkspaceInvite: (workspaceId: string, inviteId: string) =>
      request(`/api/admin/workspaces/${workspaceId}/invites/${inviteId}`, {
        method: 'DELETE',
      }),

    updateWorkspaceMember: (workspaceId: string, userId: string, data: { role: 'admin' | 'member' }) =>
      request<{ role: 'admin' | 'member' }>(`/api/admin/workspaces/${workspaceId}/members/${userId}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),

    removeWorkspaceMember: (workspaceId: string, userId: string) =>
      request(`/api/admin/workspaces/${workspaceId}/members/${userId}`, {
        method: 'DELETE',
      }),

    addWorkspaceMember: (workspaceId: string, data: { userId: string; role?: 'admin' | 'member' }) =>
      request<{ member: { userId: string; email: string; name: string; role: 'admin' | 'member' } }>(`/api/admin/workspaces/${workspaceId}/members`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),

    searchUsers: (query: string, workspaceId?: string) =>
      request<{ users: Array<{ id: string; email: string; name: string }> }>(
        `/api/admin/users/search?q=${encodeURIComponent(query)}${workspaceId ? `&workspaceId=${workspaceId}` : ''}`
      ),

    listUsers: () =>
      request<{ users: Array<UserInfo & { workspaces: Array<{ id: string; name: string; role: 'admin' | 'member' }> }> }>('/api/admin/users'),

    toggleSuperAdmin: (userId: string, isSuperAdmin: boolean) =>
      request<UserInfo>(`/api/admin/users/${userId}/super-admin`, {
        method: 'PATCH',
        body: JSON.stringify({ isSuperAdmin }),
      }),

    getAuditLogs: (params?: { workspaceId?: string; userId?: string; action?: string; limit?: number; offset?: number }) =>
      request<{ logs: AuditLogResponse[] }>(`/api/admin/audit-logs${params ? `?${new URLSearchParams(params as Record<string, string>)}` : ''}`),

    exportAuditLogs: (params?: { workspaceId?: string; userId?: string; action?: string; from?: string; to?: string }) =>
      `${apiUrl}/api/admin/audit-logs/export${params ? `?${new URLSearchParams(params)}` : ''}`,

    startImpersonation: (userId: string) =>
      request<{ originalUserId: string; impersonating: { userId: string; userName: string } }>(`/api/admin/impersonate/${userId}`, {
        method: 'POST',
      }),

    endImpersonation: () =>
      request('/api/admin/impersonate', {
        method: 'DELETE',
      }),
  };
}
