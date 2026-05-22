/**
 * Bootstrap schemas - authenticated app shell hydration
 */

import { z, registry } from '../registry.js';
import { UuidSchema, DateTimeSchema, DocumentVisibilitySchema } from './common.js';
import { DocumentTypeSchema } from './documents.js';
import { IssueListResponseSchema } from './issues.js';
import { ProgramResponseSchema } from './programs.js';
import { ProjectResponseSchema } from './projects.js';
import { AccountabilityActionItemsResponseSchema } from './accountability.js';

const BootstrapUserSchema = z.object({
  id: UuidSchema,
  email: z.string().email(),
  name: z.string(),
  isSuperAdmin: z.boolean(),
});

const BootstrapWorkspaceSchema = z.object({
  id: UuidSchema,
  name: z.string(),
  role: z.enum(['admin', 'member']).nullable().optional(),
});

const BootstrapDocumentSchema = z.object({
  id: UuidSchema,
  workspace_id: UuidSchema,
  document_type: DocumentTypeSchema,
  title: z.string(),
  parent_id: UuidSchema.nullable(),
  position: z.number().int().nullable(),
  ticket_number: z.number().int().nullable(),
  properties: z.record(z.unknown()).nullable(),
  created_at: DateTimeSchema,
  updated_at: DateTimeSchema,
  created_by: UuidSchema,
  visibility: DocumentVisibilitySchema,
});

const BootstrapStandupStatusSchema = z.object({
  due: z.boolean(),
  lastPosted: DateTimeSchema.nullable(),
});

const BootstrapProjectSchema = ProjectResponseSchema.omit({
  plan: true,
  plan_approval: true,
  retro_approval: true,
  design_review_notes: true,
}).extend({
  owner: z.object({
    id: UuidSchema,
    name: z.string().openapi({ description: 'User display name' }),
    email: z.string().email().optional().openapi({ description: 'User email address' }),
  }).nullable(),
}).openapi('BootstrapProject');

registry.register('BootstrapProject', BootstrapProjectSchema);

export const BootstrapResponseSchema = z.object({
  success: z.literal(true),
  data: z.object({
    user: BootstrapUserSchema,
    currentWorkspace: BootstrapWorkspaceSchema.nullable(),
    workspaces: z.array(BootstrapWorkspaceSchema),
    pendingAccountabilityItems: z.array(z.unknown()),
    documents: z.array(BootstrapDocumentSchema),
    programs: z.array(ProgramResponseSchema),
    projects: z.array(BootstrapProjectSchema),
    issues: z.array(IssueListResponseSchema),
    standupStatus: BootstrapStandupStatusSchema,
    actionItems: AccountabilityActionItemsResponseSchema,
  }),
}).openapi('BootstrapResponse');

registry.register('BootstrapResponse', BootstrapResponseSchema);

registry.registerPath({
  method: 'get',
  path: '/bootstrap',
  tags: ['Bootstrap'],
  summary: 'Load authenticated app shell data',
  description: 'Returns authenticated user/workspace context plus the list data needed to hydrate the main application shell query caches.',
  responses: {
    200: {
      description: 'Bootstrap payload',
      content: {
        'application/json': {
          schema: BootstrapResponseSchema,
        },
      },
    },
    401: {
      description: 'Not authenticated',
    },
  },
});
