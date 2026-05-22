/**
 * Project schemas - ICE scoring, RACI accountability, and project lifecycle
 */

import { z, registry } from '../registry.js';
import { inferredProjectStatusSchema } from '../../schemas/document-boundary.js';
import { IssuePrioritySchema, IssueStateSchema } from './issues.js';
import { UuidSchema, DateTimeSchema, UserReferenceSchema } from './common.js';

// ============== ICE Score ==============

export const ICEScoreSchema = z.number().int().min(1).max(5).openapi({
  description: 'ICE score component (1-5 scale)',
  example: 3,
});

// ============== Approval Tracking ==============

export const ApprovalStateSchema = z.enum(['approved', 'changed_since_approved', 'changes_requested']).nullable().openapi({
  description: 'Approval state: null = pending, approved = current version approved, changed_since_approved = needs re-review, changes_requested = reviewer requested revisions',
});

export const ApprovalTrackingSchema = z.object({
  state: ApprovalStateSchema,
  approved_by: UuidSchema.nullable(),
  approved_at: DateTimeSchema.nullable(),
  approved_version_id: z.number().int().nullable().openapi({
    description: 'document_history.id that was approved',
  }),
  feedback: z.string().nullable().optional().openapi({
    description: 'Feedback explaining required revisions when state is changes_requested',
  }),
  comment: z.string().nullable().optional().openapi({
    description: 'Optional manager note attached to an approval decision',
  }),
}).openapi('ApprovalTracking');

registry.register('ApprovalTracking', ApprovalTrackingSchema);

// ============== Project Response ==============

export const ProjectResponseSchema = z.object({
  id: UuidSchema,
  title: z.string(),
  // ICE scoring
  impact: ICEScoreSchema.nullable().openapi({
    description: 'How much will this move the needle? (1-5, null = not set)',
  }),
  confidence: ICEScoreSchema.nullable().openapi({
    description: 'How certain are we this will achieve the impact? (1-5, null = not set)',
  }),
  ease: ICEScoreSchema.nullable().openapi({
    description: 'How easy is this to implement? (1-5, null = not set)',
  }),
  ice_score: z.number().nullable().openapi({
    description: 'Computed ICE score (impact * confidence * ease)',
  }),
  // Visual
  color: z.string().openapi({ example: '#6366f1' }),
  emoji: z.string().nullable(),
  // Associations
  program_id: UuidSchema.nullable(),
  // RACI
  owner_id: UuidSchema.nullable().openapi({ description: 'R - Responsible (does the work)' }),
  accountable_id: UuidSchema.nullable().openapi({ description: 'A - Accountable (approver)' }),
  consulted_ids: z.array(UuidSchema).openapi({ description: 'C - Consulted (provide input)' }),
  informed_ids: z.array(UuidSchema).openapi({ description: 'I - Informed (kept in loop)' }),
  owner: UserReferenceSchema.nullable(),
  // Plan/hypothesis
  plan: z.string().nullable().openapi({
    description: 'Project hypothesis/plan statement',
  }),
  plan_approval: ApprovalTrackingSchema.nullable(),
  retro_approval: ApprovalTrackingSchema.nullable(),
  has_retro: z.boolean().openapi({
    description: 'Whether project has a retrospective document',
  }),
  // Design review
  has_design_review: z.boolean().nullable().openapi({
    description: 'Whether design review has been completed',
  }),
  design_review_notes: z.string().nullable().openapi({
    description: 'Optional notes from design review',
  }),
  target_date: DateTimeSchema.nullable(),
  // Inferred status
  inferred_status: inferredProjectStatusSchema.openapi({
    description: 'Status computed from sprint relationships',
  }),
  // Counts
  sprint_count: z.number().int(),
  issue_count: z.number().int(),
  // Completeness
  is_complete: z.boolean().nullable(),
  missing_fields: z.array(z.string()),
  // Timestamps
  created_at: DateTimeSchema,
  updated_at: DateTimeSchema,
  archived_at: DateTimeSchema.nullable(),
  converted_from_id: UuidSchema.nullable(),
}).openapi('Project');

registry.register('Project', ProjectResponseSchema);

export const ProjectIssueListItemSchema = z.object({
  id: UuidSchema,
  title: z.string(),
  ticket_number: z.number().int(),
  state: IssueStateSchema,
  priority: IssuePrioritySchema,
  assignee_id: UuidSchema.nullable(),
  assignee_name: z.string().nullable(),
  created_at: DateTimeSchema,
  updated_at: DateTimeSchema,
  started_at: DateTimeSchema.nullable(),
  completed_at: DateTimeSchema.nullable(),
  cancelled_at: DateTimeSchema.nullable(),
}).openapi('ProjectIssueListItem');

registry.register('ProjectIssueListItem', ProjectIssueListItemSchema);

export const ProjectWeekListItemSchema = z.object({
  id: UuidSchema,
  name: z.string(),
  sprint_number: z.number().int(),
  status: z.enum(['planning', 'active', 'completed']),
  owner: UserReferenceSchema.nullable(),
  project_id: UuidSchema.nullable(),
  project_name: z.string().nullable(),
  program_id: UuidSchema.nullable(),
  program_name: z.string().nullable(),
  program_prefix: z.string().nullable(),
  workspace_sprint_start_date: DateTimeSchema.nullable(),
  issue_count: z.number().int(),
  completed_count: z.number().int(),
  started_count: z.number().int(),
  plan: z.string().nullable(),
  success_criteria: z.array(z.string()).nullable(),
  confidence: z.number().int().min(0).max(100).nullable(),
}).openapi('ProjectWeekListItem');

registry.register('ProjectWeekListItem', ProjectWeekListItemSchema);

// ============== Create/Update Project ==============

export const CreateProjectSchema = z.object({
  title: z.string().min(1).max(200).optional().default('Untitled'),
  impact: ICEScoreSchema.optional().nullable().default(null),
  confidence: ICEScoreSchema.optional().nullable().default(null),
  ease: ICEScoreSchema.optional().nullable().default(null),
  owner_id: UuidSchema.optional().nullable().default(null),
  accountable_id: UuidSchema.optional().nullable().default(null),
  consulted_ids: z.array(UuidSchema).optional().default([]),
  informed_ids: z.array(UuidSchema).optional().default([]),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().default('#6366f1'),
  emoji: z.string().max(10).optional().nullable(),
  program_id: UuidSchema.optional().nullable(),
  plan: z.string().max(2000).optional().nullable(),
  target_date: DateTimeSchema.optional().nullable(),
}).openapi('CreateProject');

registry.register('CreateProject', CreateProjectSchema);

export const UpdateProjectSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  impact: ICEScoreSchema.optional().nullable(),
  confidence: ICEScoreSchema.optional().nullable(),
  ease: ICEScoreSchema.optional().nullable(),
  owner_id: UuidSchema.optional().nullable(),
  accountable_id: UuidSchema.optional().nullable(),
  consulted_ids: z.array(UuidSchema).optional(),
  informed_ids: z.array(UuidSchema).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  emoji: z.string().max(10).optional().nullable(),
  program_id: UuidSchema.optional().nullable(),
  archived_at: DateTimeSchema.optional().nullable(),
  plan: z.string().max(2000).optional().nullable(),
  target_date: DateTimeSchema.optional().nullable(),
  has_design_review: z.boolean().optional().nullable(),
  design_review_notes: z.string().max(2000).optional().nullable(),
}).openapi('UpdateProject');

registry.register('UpdateProject', UpdateProjectSchema);

// ============== Project Retro ==============

export const ProjectRetroSchema = z.object({
  plan_validated: z.boolean().nullable().optional(),
  monetary_impact_actual: z.string().max(500).nullable().optional(),
  success_criteria: z.array(z.string().max(500)).nullable().optional(),
  next_steps: z.string().max(2000).nullable().optional(),
  content: z.record(z.unknown()).optional(),
}).openapi('ProjectRetro');

registry.register('ProjectRetro', ProjectRetroSchema);

// ============== Register Project Endpoints ==============

registry.registerPath({
  method: 'get',
  path: '/projects',
  tags: ['Projects'],
  summary: 'List projects',
  description: 'List projects with optional filtering.',
  request: {
    query: z.object({
      archived: z.coerce.boolean().optional().openapi({
        description: 'Include archived projects',
      }),
      sort: z.enum(['ice_score', 'updated_at', 'created_at', 'title']).optional(),
      dir: z.enum(['asc', 'desc']).optional(),
      program_id: UuidSchema.optional(),
    }),
  },
  responses: {
    200: {
      description: 'List of projects',
      content: {
        'application/json': {
          schema: z.array(ProjectResponseSchema),
        },
      },
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/projects/{id}',
  tags: ['Projects'],
  summary: 'Get project by ID',
  request: {
    params: z.object({
      id: UuidSchema,
    }),
  },
  responses: {
    200: {
      description: 'Project details',
      content: {
        'application/json': {
          schema: ProjectResponseSchema,
        },
      },
    },
    404: {
      description: 'Project not found',
    },
  },
});

registry.registerPath({
  method: 'post',
  path: '/projects',
  tags: ['Projects'],
  summary: 'Create project',
  request: {
    body: {
      content: {
        'application/json': {
          schema: CreateProjectSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Created project',
      content: {
        'application/json': {
          schema: ProjectResponseSchema,
        },
      },
    },
    400: {
      description: 'Validation error',
    },
  },
});

registry.registerPath({
  method: 'patch',
  path: '/projects/{id}',
  tags: ['Projects'],
  summary: 'Update project',
  request: {
    params: z.object({
      id: UuidSchema,
    }),
    body: {
      content: {
        'application/json': {
          schema: UpdateProjectSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Updated project',
      content: {
        'application/json': {
          schema: ProjectResponseSchema,
        },
      },
    },
    404: {
      description: 'Project not found',
    },
  },
});

registry.registerPath({
  method: 'delete',
  path: '/projects/{id}',
  tags: ['Projects'],
  summary: 'Delete project',
  request: {
    params: z.object({
      id: UuidSchema,
    }),
  },
  responses: {
    204: {
      description: 'Project deleted',
    },
    404: {
      description: 'Project not found',
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/projects/{id}/retro',
  tags: ['Projects'],
  summary: 'Get project retro',
  description: 'Get pre-filled retrospective data for a project.',
  request: {
    params: z.object({
      id: UuidSchema,
    }),
  },
  responses: {
    200: {
      description: 'Project retro data',
      content: {
        'application/json': {
          schema: z.object({
            id: UuidSchema,
            title: z.string(),
            plan: z.string().nullable(),
            plan_validated: z.boolean().nullable(),
            monetary_impact_expected: z.string().nullable(),
            monetary_impact_actual: z.string().nullable(),
            success_criteria: z.array(z.string()).nullable(),
            next_steps: z.string().nullable(),
            content: z.record(z.unknown()).nullable(),
            sprints: z.array(z.object({
              id: UuidSchema,
              title: z.string(),
              sprint_number: z.number().int(),
            })),
            issues: z.array(z.object({
              id: UuidSchema,
              title: z.string(),
              state: z.string(),
              ticket_number: z.number().int(),
            })),
          }),
        },
      },
    },
    404: {
      description: 'Project not found',
    },
  },
});

registry.registerPath({
  method: 'patch',
  path: '/projects/{id}/retro',
  tags: ['Projects'],
  summary: 'Update project retro',
  request: {
    params: z.object({
      id: UuidSchema,
    }),
    body: {
      content: {
        'application/json': {
          schema: ProjectRetroSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Updated project retro',
      content: {
        'application/json': {
          schema: ProjectResponseSchema,
        },
      },
    },
    404: {
      description: 'Project not found',
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/projects/{id}/issues',
  tags: ['Projects'],
  summary: 'List project issues',
  request: { params: z.object({ id: UuidSchema }) },
  responses: {
    200: { description: 'Project issues', content: { 'application/json': { schema: z.array(ProjectIssueListItemSchema) } } },
    404: { description: 'Project not found' },
  },
});

registry.registerPath({
  method: 'get',
  path: '/projects/{id}/weeks',
  tags: ['Projects'],
  summary: 'List project weeks',
  request: { params: z.object({ id: UuidSchema }) },
  responses: {
    200: { description: 'Project weeks', content: { 'application/json': { schema: z.array(ProjectWeekListItemSchema) } } },
    404: { description: 'Project not found' },
  },
});

registry.registerPath({
  method: 'get',
  path: '/projects/{id}/sprints',
  tags: ['Projects'],
  summary: 'List project sprints',
  request: { params: z.object({ id: UuidSchema }) },
  responses: {
    200: { description: 'Project sprints', content: { 'application/json': { schema: z.array(ProjectWeekListItemSchema) } } },
    404: { description: 'Project not found' },
  },
});

registry.registerPath({
  method: 'post',
  path: '/projects/{id}/sprints',
  tags: ['Projects'],
  summary: 'Create project sprint',
  request: {
    params: z.object({ id: UuidSchema }),
    body: { content: { 'application/json': { schema: z.record(z.unknown()) } } },
  },
  responses: {
    201: { description: 'Sprint created' },
    404: { description: 'Project not found' },
  },
});

registry.registerPath({
  method: 'post',
  path: '/projects/{id}/retro',
  tags: ['Projects'],
  summary: 'Save project retro',
  request: {
    params: z.object({ id: UuidSchema }),
    body: { content: { 'application/json': { schema: ProjectRetroSchema } } },
  },
  responses: {
    200: { description: 'Retro saved', content: { 'application/json': { schema: ProjectResponseSchema } } },
    404: { description: 'Project not found' },
  },
});

registry.registerPath({
  method: 'post',
  path: '/projects/{id}/approve-plan',
  tags: ['Projects'],
  summary: 'Approve project plan',
  request: { params: z.object({ id: UuidSchema }) },
  responses: {
    200: { description: 'Plan approved' },
    404: { description: 'Project not found' },
  },
});

registry.registerPath({
  method: 'post',
  path: '/projects/{id}/approve-retro',
  tags: ['Projects'],
  summary: 'Approve project retro',
  request: { params: z.object({ id: UuidSchema }) },
  responses: {
    200: { description: 'Retro approved' },
    404: { description: 'Project not found' },
  },
});
