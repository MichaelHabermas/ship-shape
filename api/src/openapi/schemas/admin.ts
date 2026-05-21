/**
 * Super-admin schemas - workspace, user, audit, impersonation, and debug surfaces
 */

import { z, registry } from '../registry.js';
import { UuidSchema, DateTimeSchema, DateSchema, ApiErrorResponseSchema } from './common.js';
import {
  jsonResponse,
  JsonObjectSchema,
  successEnvelope,
  IdParamSchema,
  SuccessOnlyResponseSchema,
} from './route-helpers.js';

const AdminWorkspaceSchema = z.object({
  id: UuidSchema,
  name: z.string(),
  sprintStartDate: DateSchema.nullable().optional(),
  archivedAt: DateTimeSchema.nullable(),
  createdAt: DateTimeSchema,
  updatedAt: DateTimeSchema,
  memberCount: z.number().int().optional(),
}).passthrough().openapi('AdminWorkspace');

registry.register('AdminWorkspace', AdminWorkspaceSchema);

const AdminWorkspacesResponseSchema = successEnvelope(
  z.object({ workspaces: z.array(AdminWorkspaceSchema) }),
  'AdminWorkspacesResponse'
);
registry.register('AdminWorkspacesResponse', AdminWorkspacesResponseSchema);

const AdminJsonResponseSchema = successEnvelope(JsonObjectSchema, 'AdminJsonResponse');
registry.register('AdminJsonResponse', AdminJsonResponseSchema);

const WorkspaceIdParams = z.object({ id: UuidSchema });
const WorkspaceMemberParams = z.object({ workspaceId: UuidSchema, userId: UuidSchema });
const WorkspaceInviteParams = z.object({ workspaceId: UuidSchema, inviteId: UuidSchema });
const UserIdParams = z.object({ id: UuidSchema });
const ImpersonateParams = z.object({ userId: UuidSchema });

type RegisterPathResponses = Parameters<typeof registry.registerPath>[0]['responses'];

function adminPath(
  method: 'get' | 'post' | 'patch' | 'delete',
  path: string,
  summary: string,
  options?: {
    request?: Parameters<typeof registry.registerPath>[0]['request'];
    responses?: RegisterPathResponses;
  }
) {
  registry.registerPath({
    method,
    path,
    tags: ['Admin'],
    summary,
    request: options?.request,
    responses: options?.responses ?? {
      200: jsonResponse(AdminJsonResponseSchema, 'Success'),
      403: { description: 'Super admin required' },
    },
  });
}

adminPath('get', '/admin/workspaces', 'List all workspaces (super-admin)', {
  request: {
    query: z.object({ includeArchived: z.coerce.boolean().optional() }),
  },
  responses: {
    200: jsonResponse(AdminWorkspacesResponseSchema, 'Workspace list'),
    403: { description: 'Super admin required' },
  },
});

adminPath('post', '/admin/workspaces', 'Create workspace (super-admin)', {
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({ name: z.string().min(1) }),
        },
      },
    },
  },
  responses: {
    201: jsonResponse(
      successEnvelope(
        z.object({ workspace: AdminWorkspaceSchema }).openapi('AdminCreateWorkspaceData'),
        'AdminCreateWorkspaceResponse'
      ),
      'Workspace created'
    ),
    403: { description: 'Super admin required' },
  },
});

adminPath('get', '/admin/workspaces/{id}', 'Get workspace by ID (super-admin)', {
  request: { params: WorkspaceIdParams },
});

adminPath('patch', '/admin/workspaces/{id}', 'Update workspace (super-admin)', {
  request: {
    params: WorkspaceIdParams,
    body: {
      content: {
        'application/json': {
          schema: z.object({ name: z.string().min(1).optional() }).passthrough(),
        },
      },
    },
  },
});

adminPath('post', '/admin/workspaces/{id}/archive', 'Archive workspace (super-admin)', {
  request: { params: WorkspaceIdParams },
  responses: {
    200: jsonResponse(SuccessOnlyResponseSchema, 'Workspace archived'),
    403: { description: 'Super admin required' },
  },
});

adminPath('get', '/admin/workspaces/{id}/members', 'List workspace members (super-admin)', {
  request: { params: WorkspaceIdParams },
});

adminPath('post', '/admin/workspaces/{id}/members', 'Add workspace member (super-admin)', {
  request: {
    params: WorkspaceIdParams,
    body: {
      content: {
        'application/json': {
          schema: z.object({
            email: z.string().email(),
            role: z.enum(['admin', 'member']).optional(),
          }),
        },
      },
    },
  },
  responses: {
    201: jsonResponse(AdminJsonResponseSchema, 'Member added'),
    403: { description: 'Super admin required' },
    409: jsonResponse(ApiErrorResponseSchema, 'User already a member'),
  },
});

adminPath('patch', '/admin/workspaces/{workspaceId}/members/{userId}', 'Update workspace member (super-admin)', {
  request: {
    params: WorkspaceMemberParams,
    body: {
      content: {
        'application/json': {
          schema: z.object({ role: z.enum(['admin', 'member']) }),
        },
      },
    },
  },
});

adminPath('delete', '/admin/workspaces/{workspaceId}/members/{userId}', 'Remove workspace member (super-admin)', {
  request: { params: WorkspaceMemberParams },
  responses: {
    200: jsonResponse(SuccessOnlyResponseSchema, 'Member removed'),
    403: { description: 'Super admin required' },
  },
});

adminPath('get', '/admin/workspaces/{id}/invites', 'List workspace invites (super-admin)', {
  request: { params: WorkspaceIdParams },
});

adminPath('post', '/admin/workspaces/{id}/invites', 'Create workspace invite (super-admin)', {
  request: {
    params: WorkspaceIdParams,
    body: {
      content: {
        'application/json': {
          schema: z.object({
            email: z.string().email(),
            role: z.enum(['admin', 'member']).optional(),
          }),
        },
      },
    },
  },
  responses: {
    201: jsonResponse(AdminJsonResponseSchema, 'Invite created'),
    403: { description: 'Super admin required' },
    409: jsonResponse(ApiErrorResponseSchema, 'Invite already exists'),
  },
});

adminPath('delete', '/admin/workspaces/{workspaceId}/invites/{inviteId}', 'Revoke workspace invite (super-admin)', {
  request: { params: WorkspaceInviteParams },
  responses: {
    200: jsonResponse(SuccessOnlyResponseSchema, 'Invite revoked'),
    403: { description: 'Super admin required' },
  },
});

adminPath('get', '/admin/users', 'List users (super-admin)');
adminPath('get', '/admin/users/search', 'Search users (super-admin)', {
  request: {
    query: z.object({ q: z.string().optional(), limit: z.coerce.number().int().optional() }),
  },
});

adminPath('patch', '/admin/users/{id}/super-admin', 'Toggle super-admin flag', {
  request: {
    params: UserIdParams,
    body: {
      content: {
        'application/json': {
          schema: z.object({ isSuperAdmin: z.boolean() }),
        },
      },
    },
  },
});

adminPath('get', '/admin/audit-logs', 'List audit logs (super-admin)', {
  request: {
    query: z.object({
      page: z.coerce.number().int().optional(),
      limit: z.coerce.number().int().optional(),
      workspaceId: UuidSchema.optional(),
      userId: UuidSchema.optional(),
    }),
  },
});

adminPath('get', '/admin/audit-logs/export', 'Export audit logs (super-admin)', {
  responses: {
    200: { description: 'CSV export' },
    403: { description: 'Super admin required' },
  },
});

adminPath('post', '/admin/impersonate/{userId}', 'Start impersonation session', {
  request: { params: ImpersonateParams },
});

adminPath('delete', '/admin/impersonate', 'End impersonation session', {
  responses: {
    200: jsonResponse(SuccessOnlyResponseSchema, 'Impersonation ended'),
    403: { description: 'Super admin required' },
  },
});

adminPath('get', '/admin/debug/users', 'List users for debug tooling');
adminPath('get', '/admin/debug/orphans', 'List orphan records for debug tooling');
adminPath('post', '/admin/debug/orphans/fix', 'Fix orphan records');
adminPath('delete', '/admin/debug/users/{id}', 'Delete debug user record', {
  request: { params: UserIdParams },
});
