// In development, Vite proxy handles /api routes (see vite.config.ts)
// In production, use VITE_API_URL or relative URLs
import { clearTypedApiCsrfToken } from '@/api/client';

const API_URL = import.meta.env.VITE_API_URL ?? '';

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
  };
}

interface CsrfTokenResponse {
  token: string;
}

// CSRF token cache for state-changing requests
let csrfToken: string | null = null;

// Helper: Check if response has JSON content type
function isJsonResponse(response: Response): boolean {
  const contentType = response.headers.get('content-type');
  return contentType?.includes('application/json') ?? false;
}

export async function readJson<T>(response: Response): Promise<T> {
  const data = (await response.json()) as unknown;
  return data as T;
}

/**
 * Handle session expiration - redirect to login with expired=true flag
 *
 * IMPORTANT: Only call this for actual session expiration (SESSION_EXPIRED error code),
 * NOT for missing sessions (UNAUTHORIZED). Fresh visitors with no session should get
 * a clean redirect via ProtectedRoute without the "session expired" message.
 *
 * The expired=true flag triggers the yellow "session expired" modal on the login page.
 * Fresh visitors shouldn't see this - it would be confusing UX.
 *
 * Returns `never` because it always redirects or throws.
 */
function handleSessionExpired(): never {
  // Don't redirect to login when offline - let TanStack Query handle retries
  if (!navigator.onLine) {
    throw new Error('Network offline - request failed');
  }
  // Don't redirect on public routes like /invite - they work without authentication
  if (window.location.pathname.startsWith('/invite')) {
    throw new Error('Session check failed - continuing on public route');
  }
  if (window.location.pathname !== '/login') {
    const returnTo = encodeURIComponent(
      window.location.pathname + window.location.search + window.location.hash
    );
    window.location.href = `/login?expired=true&returnTo=${returnTo}`;
  }
  // Throw to satisfy TypeScript's `never` type (redirect is async)
  throw new Error('Session expired - redirecting to login');
}

async function ensureCsrfToken(): Promise<string> {
  if (!csrfToken) {
    const response = await fetch(`${API_URL}/api/csrf-token`, {
      credentials: 'include',
    });
    if (!response.ok || !isJsonResponse(response)) {
      // Session likely expired - redirect to login
      if (response.status === 401 || response.status === 403) {
        handleSessionExpired(); // never returns
      }
      throw new Error('Failed to get CSRF token');
    }
    const data = await readJson<CsrfTokenResponse>(response);
    csrfToken = data.token;
  }
  if (!csrfToken) {
    throw new Error('Failed to get CSRF token');
  }
  return csrfToken;
}

// Clear CSRF token on logout or session change
export function clearCsrfToken(): void {
  csrfToken = null;
  clearTypedApiCsrfToken();
}

// Simple helpers that return Response objects (for contexts that need res.ok checks)
async function fetchWithCsrf(
  endpoint: string,
  method: 'POST' | 'PATCH' | 'DELETE',
  body?: object
): Promise<Response> {
  const token = await ensureCsrfToken();
  const res = await fetch(`${API_URL}${endpoint}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-Token': token,
    },
    credentials: 'include',
    body: body ? JSON.stringify(body) : undefined,
  });

  const isJson = isJsonResponse(res);

  // CloudFront intercepts 403s and returns HTML - detect and redirect to login
  if (res.status === 403 && !isJson) {
    handleSessionExpired(); // never returns
  }

  // If CSRF token invalid (403 with JSON), retry once
  if (res.status === 403 && isJson) {
    clearCsrfToken();
    const newToken = await ensureCsrfToken();
    return fetch(`${API_URL}${endpoint}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': newToken,
      },
      credentials: 'include',
      body: body ? JSON.stringify(body) : undefined,
    });
  }
  return res;
}

export async function apiGet(endpoint: string): Promise<Response> {
  const res = await fetch(`${API_URL}${endpoint}`, {
    credentials: 'include',
  });

  // Handle session expiration - redirect to login
  if (res.status === 401) {
    handleSessionExpired(); // never returns
  }

  // Check for non-JSON response (CloudFront HTML interception)
  // This can happen when:
  // 1. CDN serves HTML error page for non-existent routes
  // 2. Session expired and CloudFront returns login page
  // 3. Route misconfiguration serving index.html for API routes
  if (!isJsonResponse(res)) {
    // Non-200 + non-JSON = likely session issue (CloudFront 403 interception)
    if (res.status !== 200) {
      handleSessionExpired(); // never returns
    }
    // 200 + non-JSON = likely routing/CDN misconfiguration
    // Don't redirect to login (not a session issue), throw error for React Query to handle
    throw new Error(`API returned HTML instead of JSON for ${endpoint}. This may indicate a routing or CDN configuration issue.`);
  }

  return res;
}

export async function apiPost(endpoint: string, body?: object): Promise<Response> {
  return fetchWithCsrf(endpoint, 'POST', body);
}

export async function apiPatch(endpoint: string, body: object): Promise<Response> {
  return fetchWithCsrf(endpoint, 'PATCH', body);
}

export async function apiDelete(endpoint: string, body?: object): Promise<Response> {
  return fetchWithCsrf(endpoint, 'DELETE', body);
}

async function request<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<ApiResponse<T>> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };

  // Add CSRF token for state-changing requests
  const method = options.method?.toUpperCase() || 'GET';
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    const token = await ensureCsrfToken();
    headers['X-CSRF-Token'] = token;
  }

  const response = await fetch(`${API_URL}${endpoint}`, {
    ...options,
    credentials: 'include',
    headers,
  });

  // CloudFront may intercept errors and return HTML - detect and redirect
  if (!isJsonResponse(response)) {
    // On public routes like /invite, return error response instead of redirecting
    if (window.location.pathname.startsWith('/invite')) {
      return {
        success: false,
        error: { code: 'NETWORK_ERROR', message: 'Server returned non-JSON response' },
      };
    }
    handleSessionExpired(); // never returns
  }

  const data = await readJson<ApiResponse<T>>(response);

  // Handle session expiration - redirect to login with expired=true
  // Only for SESSION_EXPIRED (actual expiration), not UNAUTHORIZED (no session existed)
  // Skip for public routes like /invite where 401 is expected for unauthenticated users
  if (response.status === 401) {
    if (data.error?.code === 'SESSION_EXPIRED') {
      if (!window.location.pathname.startsWith('/invite')) {
        handleSessionExpired(); // never returns - shows "session expired" message
      }
    }
    // UNAUTHORIZED (no session) just returns error - ProtectedRoute will redirect without expired message
    return data;
  }

  // If CSRF token is invalid, clear and retry once
  if (response.status === 403 && data.error?.code === 'CSRF_ERROR') {
    clearCsrfToken();
    const newToken = await ensureCsrfToken();
    headers['X-CSRF-Token'] = newToken;
    const retryResponse = await fetch(`${API_URL}${endpoint}`, {
      ...options,
      credentials: 'include',
      headers,
    });
    if (!isJsonResponse(retryResponse)) {
      handleSessionExpired(); // never returns
    }
    return readJson<ApiResponse<T>>(retryResponse);
  }

  return data;
}

// Types for workspace management
export interface Workspace {
  id: string;
  name: string;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceMembership {
  id: string;
  workspaceId: string;
  userId: string;
  role: 'admin' | 'member';
  personDocumentId: string | null;
  createdAt: string;
}

export interface WorkspaceInvite {
  id: string;
  workspaceId: string;
  email: string;
  x509SubjectDn: string | null;
  token: string;
  role: 'admin' | 'member';
  expiresAt: string;
  createdAt: string;
}

export interface AuditLog {
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

export interface ApiToken {
  id: string;
  name: string;
  token_prefix: string;
  last_used_at: string | null;
  expires_at: string | null;
  is_active: boolean;
  revoked_at: string | null;
  created_at: string;
}

export interface ApiTokenCreateResponse extends ApiToken {
  token: string; // Full token - only returned on creation
  warning: string;
}

export interface WorkspaceMember {
  id: string;
  userId: string;
  email: string;
  name: string;
  role: 'admin' | 'member' | null;
  personDocumentId: string | null;
  joinedAt: string | null;
  isArchived?: boolean;
}

export interface UserInfo {
  id: string;
  email: string;
  name: string;
  isSuperAdmin: boolean;
}

// Accountability item returned by auth endpoints
export interface AccountabilityItem {
  id: string;
  title: string;
  accountability_type: 'standup' | 'weekly_plan' | 'weekly_review' | 'week_start' | 'week_issues' | 'project_plan' | 'project_retro';
  accountability_target_id: string;
  due_date: string | null;
  is_system_generated: boolean;
}

export interface LoginResponse {
  user: UserInfo;
  currentWorkspace: Workspace;
  workspaces: Array<Workspace & { role: 'admin' | 'member' }>;
  pendingAccountabilityItems?: AccountabilityItem[];
}

export interface MeResponse {
  user: UserInfo;
  currentWorkspace: Workspace | null;
  workspaces: Array<Workspace & { role: 'admin' | 'member' }>;
  impersonating?: {
    userId: string;
    userName: string;
  };
  pendingAccountabilityItems?: AccountabilityItem[];
}

export interface BootstrapResponse extends MeResponse {
  documents: unknown[];
  programs: unknown[];
  projects: unknown[];
  issues: unknown[];
  standupStatus: unknown;
  actionItems: unknown;
}

export const api = {
  auth: {
    login: (email: string, password: string) =>
      request<LoginResponse>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      }),
    logout: () => {
      clearCsrfToken(); // Clear token on logout
      return request('/api/auth/logout', {
        method: 'POST',
      });
    },
    me: () => request<MeResponse>('/api/auth/me'),
    bootstrap: () => request<BootstrapResponse>('/api/bootstrap'),
  },

  workspaces: {
    // User-facing workspace operations
    list: () =>
      request<Array<Workspace & { role: 'admin' | 'member' }>>('/api/workspaces'),

    getCurrent: () =>
      request<Workspace>('/api/workspaces/current'),

    switch: (workspaceId: string) =>
      request<{ workspace: Workspace }>(`/api/workspaces/${workspaceId}/switch`, {
        method: 'POST',
      }),

    // Member management (workspace admin)
    getMembers: (workspaceId: string, options?: { includeArchived?: boolean }) => {
      const params = new URLSearchParams();
      if (options?.includeArchived) params.set('includeArchived', 'true');
      const query = params.toString();
      return request<{ members: WorkspaceMember[] }>(`/api/workspaces/${workspaceId}/members${query ? `?${query}` : ''}`);
    },

    addMember: (workspaceId: string, data: { userId?: string; email?: string; role: 'admin' | 'member' }) =>
      request<WorkspaceMembership>(`/api/workspaces/${workspaceId}/members`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),

    updateMember: (workspaceId: string, userId: string, data: { role: 'admin' | 'member' }) =>
      request<WorkspaceMembership>(`/api/workspaces/${workspaceId}/members/${userId}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),

    removeMember: (workspaceId: string, userId: string) =>
      request(`/api/workspaces/${workspaceId}/members/${userId}`, {
        method: 'DELETE',
      }),

    restoreMember: (workspaceId: string, userId: string) =>
      request(`/api/workspaces/${workspaceId}/members/${userId}/restore`, {
        method: 'POST',
      }),

    // Invite management (workspace admin)
    getInvites: (workspaceId: string) =>
      request<{ invites: WorkspaceInvite[] }>(`/api/workspaces/${workspaceId}/invites`),

    createInvite: (workspaceId: string, data: { email: string; x509SubjectDn?: string; role?: 'admin' | 'member' }) =>
      request<{ invite: WorkspaceInvite }>(`/api/workspaces/${workspaceId}/invites`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),

    revokeInvite: (workspaceId: string, inviteId: string) =>
      request(`/api/workspaces/${workspaceId}/invites/${inviteId}`, {
        method: 'DELETE',
      }),

    // Audit logs (workspace admin)
    getAuditLogs: (workspaceId: string, params?: { limit?: number; offset?: number }) =>
      request<{ logs: AuditLog[] }>(
        `/api/workspaces/${workspaceId}/audit-logs${params ? `?${new URLSearchParams(params as Record<string, string>)}` : ''}`
      ),
  },

  admin: {
    // Super-admin workspace management
    listWorkspaces: (includeArchived = false) =>
      request<{ workspaces: Array<Workspace & { memberCount: number }> }>(`/api/admin/workspaces?archived=${includeArchived}`),

    createWorkspace: (data: { name: string }) =>
      request<{ workspace: Workspace }>('/api/admin/workspaces', {
        method: 'POST',
        body: JSON.stringify(data),
      }),

    updateWorkspace: (workspaceId: string, data: { name?: string }) =>
      request<Workspace>(`/api/admin/workspaces/${workspaceId}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),

    archiveWorkspace: (workspaceId: string) =>
      request<Workspace>(`/api/admin/workspaces/${workspaceId}/archive`, {
        method: 'POST',
      }),

    // Super-admin workspace detail and member management
    getWorkspace: (workspaceId: string) =>
      request<{ workspace: Workspace & { sprintStartDate: string | null } }>(`/api/admin/workspaces/${workspaceId}`),

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

    // User search (for adding existing users to workspace)
    searchUsers: (query: string, workspaceId?: string) =>
      request<{ users: Array<{ id: string; email: string; name: string }> }>(
        `/api/admin/users/search?q=${encodeURIComponent(query)}${workspaceId ? `&workspaceId=${workspaceId}` : ''}`
      ),

    // Super-admin user management
    listUsers: () =>
      request<{ users: Array<UserInfo & { workspaces: Array<{ id: string; name: string; role: 'admin' | 'member' }> }> }>('/api/admin/users'),

    toggleSuperAdmin: (userId: string, isSuperAdmin: boolean) =>
      request<UserInfo>(`/api/admin/users/${userId}/super-admin`, {
        method: 'PATCH',
        body: JSON.stringify({ isSuperAdmin }),
      }),

    // Audit logs (super-admin)
    getAuditLogs: (params?: { workspaceId?: string; userId?: string; action?: string; limit?: number; offset?: number }) =>
      request<{ logs: AuditLog[] }>(`/api/admin/audit-logs${params ? `?${new URLSearchParams(params as Record<string, string>)}` : ''}`),

    exportAuditLogs: (params?: { workspaceId?: string; userId?: string; action?: string; from?: string; to?: string }) =>
      `${API_URL}/api/admin/audit-logs/export${params ? `?${new URLSearchParams(params)}` : ''}`,

    // Impersonation
    startImpersonation: (userId: string) =>
      request<{ originalUserId: string; impersonating: { userId: string; userName: string } }>(`/api/admin/impersonate/${userId}`, {
        method: 'POST',
      }),

    endImpersonation: () =>
      request('/api/admin/impersonate', {
        method: 'DELETE',
      }),
  },

  invites: {
    // Public invite operations
    validate: (token: string) =>
      request<{ email: string; workspaceName: string; invitedBy: string; role: 'admin' | 'member'; userExists: boolean; alreadyMember?: boolean }>(`/api/invites/${token}`),

    accept: (token: string, data?: { password?: string; name?: string }) =>
      request<LoginResponse>(`/api/invites/${token}/accept`, {
        method: 'POST',
        body: JSON.stringify(data || {}),
      }),
  },

  apiTokens: {
    list: () =>
      request<ApiToken[]>('/api/api-tokens'),

    create: (data: { name: string; expires_in_days?: number }) =>
      request<ApiTokenCreateResponse>('/api/api-tokens', {
        method: 'POST',
        body: JSON.stringify(data),
      }),

    revoke: (tokenId: string) =>
      request('/api/api-tokens/' + tokenId, {
        method: 'DELETE',
      }),
  },
};
