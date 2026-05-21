/**
 * Workspace schemas - Multi-tenant workspace management
 */

import { z, registry } from '../registry.js';
import { UuidSchema, DateTimeSchema, DateSchema, ApiErrorResponseSchema } from './common.js';
import { jsonResponse, successEnvelope, SuccessOnlyResponseSchema } from './route-helpers.js';

// ============== Workspace ==============

export const WorkspaceSchema = z.object({
  id: UuidSchema,
  name: z.string(),
  sprintStartDate: z.union([DateSchema, DateTimeSchema]).nullable().openapi({
    description: 'Anchor date for computing sprint numbers and dates',
  }),
  archivedAt: DateTimeSchema.nullable(),
  createdAt: DateTimeSchema,
  updatedAt: DateTimeSchema,
  role: z.enum(['admin', 'member']).openapi({
    description: 'Current user\'s role in this workspace',
  }),
  isSuperAdmin: z.boolean().optional().openapi({
    description: 'True if user is super-admin (can access all workspaces)',
  }),
}).openapi('Workspace');

registry.register('Workspace', WorkspaceSchema);

// ============== Workspace List Response ==============

export const WorkspaceListResponseSchema = z.object({
  success: z.literal(true),
  data: z.object({
    workspaces: z.array(WorkspaceSchema),
    isSuperAdmin: z.boolean(),
  }),
}).openapi('WorkspaceListResponse');

registry.register('WorkspaceListResponse', WorkspaceListResponseSchema);

// ============== Create/Update Workspace ==============

export const CreateWorkspaceSchema = z.object({
  name: z.string().min(1).max(200),
  sprintStartDate: DateSchema.optional().openapi({
    description: 'Defaults to next Monday if not provided',
  }),
}).openapi('CreateWorkspace');

registry.register('CreateWorkspace', CreateWorkspaceSchema);

export const UpdateWorkspaceSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  sprintStartDate: DateSchema.optional(),
}).openapi('UpdateWorkspace');

registry.register('UpdateWorkspace', UpdateWorkspaceSchema);

// ============== Register Workspace Endpoints ==============

registry.registerPath({
  method: 'get',
  path: '/workspaces',
  tags: ['Workspaces'],
  summary: 'List workspaces',
  description: 'List all workspaces the current user has access to.',
  responses: {
    200: {
      description: 'List of workspaces',
      content: {
        'application/json': {
          schema: WorkspaceListResponseSchema,
        },
      },
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/workspaces/current',
  tags: ['Workspaces'],
  summary: 'Get current workspace',
  description: 'Get the workspace currently selected in the session.',
  responses: {
    200: {
      description: 'Current workspace',
      content: {
        'application/json': {
          schema: z.object({
            success: z.literal(true),
            data: z.object({
              workspace: WorkspaceSchema,
            }),
          }),
        },
      },
    },
    400: {
      description: 'No workspace selected',
    },
  },
});

registry.registerPath({
  method: 'post',
  path: '/workspaces/{id}/switch',
  tags: ['Workspaces'],
  summary: 'Switch workspace',
  description: 'Switch to a different workspace. Updates the session.',
  request: {
    params: z.object({
      id: UuidSchema,
    }),
  },
  responses: {
    200: jsonResponse(
      successEnvelope(
        z.object({
          workspaceId: UuidSchema,
        }).openapi('WorkspaceSwitchData'),
        'WorkspaceSwitchResponse'
      ),
      'Workspace switched'
    ),
    403: {
      description: 'No access to workspace',
    },
    404: {
      description: 'Workspace not found',
    },
  },
});

const WorkspaceMemberSchema = z.object({
  id: UuidSchema,
  userId: UuidSchema.nullable(),
  email: z.string().email(),
  name: z.string(),
  role: z.enum(['admin', 'member']).nullable(),
  personDocumentId: UuidSchema.nullable(),
  joinedAt: DateTimeSchema.nullable(),
  isArchived: z.boolean(),
}).openapi('WorkspaceMember');

registry.register('WorkspaceMember', WorkspaceMemberSchema);

const WorkspaceMembersListResponseSchema = successEnvelope(
  z.object({ members: z.array(WorkspaceMemberSchema) }).openapi('WorkspaceMembersListData'),
  'WorkspaceMembersListResponse'
);
registry.register('WorkspaceMembersListResponse', WorkspaceMembersListResponseSchema);

registry.registerPath({
  method: 'get',
  path: '/workspaces/{id}/members',
  tags: ['Workspaces'],
  summary: 'List workspace members',
  request: {
    params: z.object({ id: UuidSchema }),
    query: z.object({ includeArchived: z.coerce.boolean().optional() }),
  },
  responses: {
    200: jsonResponse(WorkspaceMembersListResponseSchema, 'Members'),
    403: { description: 'Workspace admin required' },
  },
});

registry.registerPath({
  method: 'post',
  path: '/workspaces/{id}/members',
  tags: ['Workspaces'],
  summary: 'Add existing user to workspace',
  request: {
    params: z.object({ id: UuidSchema }),
    body: {
      content: {
        'application/json': {
          schema: z.object({
            userId: UuidSchema,
            role: z.enum(['admin', 'member']).optional(),
          }),
        },
      },
    },
  },
  responses: {
    201: jsonResponse(WorkspaceMembersListResponseSchema, 'Member added'),
    403: { description: 'Workspace admin required' },
    409: jsonResponse(ApiErrorResponseSchema, 'User already a member'),
  },
});

registry.registerPath({
  method: 'patch',
  path: '/workspaces/{id}/members/{userId}',
  tags: ['Workspaces'],
  summary: 'Update workspace member',
  request: {
    params: z.object({ id: UuidSchema, userId: UuidSchema }),
    body: { content: { 'application/json': { schema: z.object({ role: z.enum(['admin', 'member']) }) } } },
  },
  responses: { 200: { description: 'Member updated' }, 403: { description: 'Workspace admin required' } },
});

registry.registerPath({
  method: 'delete',
  path: '/workspaces/{id}/members/{userId}',
  tags: ['Workspaces'],
  summary: 'Archive workspace member',
  request: { params: z.object({ id: UuidSchema, userId: UuidSchema }) },
  responses: {
    200: jsonResponse(SuccessOnlyResponseSchema, 'Member archived'),
    403: { description: 'Workspace admin required' },
  },
});

registry.registerPath({
  method: 'post',
  path: '/workspaces/{id}/members/{userId}/restore',
  tags: ['Workspaces'],
  summary: 'Restore archived workspace member',
  request: { params: z.object({ id: UuidSchema, userId: UuidSchema }) },
  responses: { 200: { description: 'Member restored' }, 403: { description: 'Workspace admin required' } },
});

registry.registerPath({
  method: 'get',
  path: '/workspaces/{id}/invites',
  tags: ['Workspaces'],
  summary: 'List workspace invites',
  request: { params: z.object({ id: UuidSchema }) },
  responses: { 200: { description: 'Invites', content: { 'application/json': { schema: z.array(z.record(z.unknown())) } } } },
});

registry.registerPath({
  method: 'post',
  path: '/workspaces/{id}/invites',
  tags: ['Workspaces'],
  summary: 'Create workspace invite',
  request: {
    params: z.object({ id: UuidSchema }),
    body: { content: { 'application/json': { schema: z.object({ email: z.string().email(), role: z.enum(['admin', 'member']).optional() }) } } },
  },
  responses: { 201: { description: 'Invite created' } },
});

registry.registerPath({
  method: 'delete',
  path: '/workspaces/{id}/invites/{inviteId}',
  tags: ['Workspaces'],
  summary: 'Revoke workspace invite',
  request: { params: z.object({ id: UuidSchema, inviteId: UuidSchema }) },
  responses: { 200: jsonResponse(SuccessOnlyResponseSchema, 'Invite revoked') },
});

registry.registerPath({
  method: 'get',
  path: '/workspaces/{id}/audit-logs',
  tags: ['Workspaces'],
  summary: 'List workspace audit logs',
  request: {
    params: z.object({ id: UuidSchema }),
    query: z.object({ page: z.coerce.number().int().optional(), limit: z.coerce.number().int().optional() }),
  },
  responses: { 200: { description: 'Audit logs', content: { 'application/json': { schema: z.record(z.unknown()) } } } },
});
