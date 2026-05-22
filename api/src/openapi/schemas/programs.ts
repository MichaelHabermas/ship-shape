/**
 * Program schemas - Top-level grouping with RACI accountability
 */

import { z, registry } from '../registry.js';
import { inferredProjectStatusSchema } from '../../schemas/document-boundary.js';
import { UuidSchema, DateTimeSchema, UserReferenceSchema, DateSchema } from './common.js';

// ============== Program Response ==============

export const ProgramResponseSchema = z.object({
  id: UuidSchema,
  name: z.string(),
  color: z.string().openapi({ example: '#6366f1' }),
  emoji: z.string().nullable(),
  archived_at: DateTimeSchema.nullable(),
  created_at: DateTimeSchema,
  updated_at: DateTimeSchema,
  issue_count: z.number().int(),
  sprint_count: z.number().int(),
  owner: UserReferenceSchema.nullable(),
  // RACI
  owner_id: UuidSchema.nullable().openapi({ description: 'R - Responsible' }),
  accountable_id: UuidSchema.nullable().openapi({ description: 'A - Accountable' }),
  consulted_ids: z.array(UuidSchema).openapi({ description: 'C - Consulted' }),
  informed_ids: z.array(UuidSchema).openapi({ description: 'I - Informed' }),
}).openapi('Program');

registry.register('Program', ProgramResponseSchema);

export const ProgramSprintListItemSchema = z.object({
  id: UuidSchema,
  name: z.string(),
  sprint_number: z.number().int(),
  status: z.enum(['planning', 'active', 'completed']),
  owner: UserReferenceSchema.nullable(),
  issue_count: z.number().int(),
  completed_count: z.number().int(),
  started_count: z.number().int(),
  total_estimate_hours: z.number(),
  has_plan: z.boolean(),
  has_retro: z.boolean(),
  plan_created_at: DateTimeSchema.nullable(),
  retro_created_at: DateTimeSchema.nullable(),
  plan: z.string().nullable(),
}).openapi('ProgramSprintListItem');

registry.register('ProgramSprintListItem', ProgramSprintListItemSchema);

export const ProgramSprintsResponseSchema = z.object({
  workspace_sprint_start_date: DateSchema,
  weeks: z.array(ProgramSprintListItemSchema),
}).openapi('ProgramSprintsResponse');

registry.register('ProgramSprintsResponse', ProgramSprintsResponseSchema);

// ============== Create/Update Program ==============

export const CreateProgramSchema = z.object({
  title: z.string().min(1).max(200).optional().default('Untitled'),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().default('#6366f1'),
  emoji: z.string().max(10).optional().nullable(),
  owner_id: UuidSchema.optional().nullable().default(null),
  accountable_id: UuidSchema.optional().nullable().default(null),
  consulted_ids: z.array(UuidSchema).optional().default([]),
  informed_ids: z.array(UuidSchema).optional().default([]),
}).openapi('CreateProgram');

registry.register('CreateProgram', CreateProgramSchema);

export const UpdateProgramSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  emoji: z.string().max(10).optional().nullable(),
  owner_id: UuidSchema.optional().nullable(),
  accountable_id: UuidSchema.optional().nullable(),
  consulted_ids: z.array(UuidSchema).optional(),
  informed_ids: z.array(UuidSchema).optional(),
  archived_at: DateTimeSchema.optional().nullable(),
}).openapi('UpdateProgram');

registry.register('UpdateProgram', UpdateProgramSchema);

// ============== Register Program Endpoints ==============

registry.registerPath({
  method: 'get',
  path: '/programs',
  tags: ['Programs'],
  summary: 'List programs',
  request: {
    query: z.object({
      archived: z.coerce.boolean().optional().openapi({
        description: 'Include archived programs',
      }),
    }),
  },
  responses: {
    200: {
      description: 'List of programs',
      content: {
        'application/json': {
          schema: z.array(ProgramResponseSchema),
        },
      },
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/programs/{id}',
  tags: ['Programs'],
  summary: 'Get program by ID',
  request: {
    params: z.object({
      id: UuidSchema,
    }),
  },
  responses: {
    200: {
      description: 'Program details',
      content: {
        'application/json': {
          schema: ProgramResponseSchema,
        },
      },
    },
    404: {
      description: 'Program not found',
    },
  },
});

registry.registerPath({
  method: 'post',
  path: '/programs',
  tags: ['Programs'],
  summary: 'Create program',
  request: {
    body: {
      content: {
        'application/json': {
          schema: CreateProgramSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Created program',
      content: {
        'application/json': {
          schema: ProgramResponseSchema,
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
  path: '/programs/{id}',
  tags: ['Programs'],
  summary: 'Update program',
  request: {
    params: z.object({
      id: UuidSchema,
    }),
    body: {
      content: {
        'application/json': {
          schema: UpdateProgramSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Updated program',
      content: {
        'application/json': {
          schema: ProgramResponseSchema,
        },
      },
    },
    404: {
      description: 'Program not found',
    },
  },
});

registry.registerPath({
  method: 'delete',
  path: '/programs/{id}',
  tags: ['Programs'],
  summary: 'Delete program',
  request: {
    params: z.object({
      id: UuidSchema,
    }),
  },
  responses: {
    204: {
      description: 'Program deleted',
    },
    404: {
      description: 'Program not found',
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/programs/{id}/issues',
  tags: ['Programs'],
  summary: 'Get program issues',
  description: 'Get all issues associated with this program.',
  request: {
    params: z.object({
      id: UuidSchema,
    }),
    query: z.object({
      state: z.string().optional(),
      limit: z.coerce.number().int().optional(),
    }),
  },
  responses: {
    200: {
      description: 'List of program issues',
      content: {
        'application/json': {
          schema: z.array(z.object({
            id: UuidSchema,
            title: z.string(),
            state: z.string(),
            priority: z.string(),
            ticket_number: z.number().int(),
            display_id: z.string(),
            assignee_id: UuidSchema.nullable(),
            assignee_name: z.string().nullable(),
          })),
        },
      },
    },
    404: {
      description: 'Program not found',
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/programs/{id}/projects',
  tags: ['Programs'],
  summary: 'Get program projects',
  description: 'Get all projects associated with this program.',
  request: {
    params: z.object({
      id: UuidSchema,
    }),
    query: z.object({
      archived: z.coerce.boolean().optional(),
    }),
  },
  responses: {
    200: {
      description: 'List of program projects',
      content: {
        'application/json': {
          schema: z.array(z.object({
            id: UuidSchema,
            title: z.string(),
            ice_score: z.number().nullable(),
            inferred_status: inferredProjectStatusSchema,
            color: z.string(),
            emoji: z.string().nullable(),
            issue_count: z.number().int(),
          })),
        },
      },
    },
    404: {
      description: 'Program not found',
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/programs/{id}/sprints',
  tags: ['Programs'],
  summary: 'Get program sprints',
  description: 'Get all sprints associated with this program.',
  request: {
    params: z.object({
      id: UuidSchema,
    }),
    query: z.object({
      status: z.enum(['planning', 'active', 'completed']).optional(),
    }),
  },
  responses: {
    200: {
      description: 'List of program sprints',
      content: {
        'application/json': {
          schema: ProgramSprintsResponseSchema,
        },
      },
    },
    404: {
      description: 'Program not found',
    },
  },
});

// ============== Program Merge ==============

const MergePreviewSchema = registry.register('MergePreview', z.object({
  source: z.object({ id: UuidSchema, name: z.string() }),
  target: z.object({ id: UuidSchema, name: z.string() }),
  counts: z.object({
    projects: z.number().int(),
    issues: z.number().int(),
    sprints: z.number().int(),
    wikis: z.number().int(),
  }),
  conflicts: z.array(z.object({
    type: z.string(),
    message: z.string(),
  })),
}));

registry.registerPath({
  method: 'get',
  path: '/programs/{id}/merge-preview',
  operationId: 'get_program_merge_preview',
  tags: ['Programs'],
  summary: 'Preview program merge',
  description: 'Returns counts of entities that will be moved from source to target program, plus any conflicts.',
  request: {
    params: z.object({
      id: UuidSchema,
    }),
    query: z.object({
      target_id: UuidSchema.openapi({ description: 'Target program ID to merge into' }),
    }),
  },
  responses: {
    200: {
      description: 'Merge preview with entity counts and conflicts',
      content: {
        'application/json': {
          schema: MergePreviewSchema,
        },
      },
    },
    400: { description: 'Invalid request (missing target_id, same program, or archived program)' },
    404: { description: 'Program not found' },
  },
});

const MergeProgramRequestSchema = registry.register('MergeProgramRequest', z.object({
  target_id: UuidSchema.openapi({ description: 'Target program ID to merge into' }),
  confirm_name: z.string().min(1).openapi({ description: 'Source program name for type-to-confirm safeguard' }),
}));

registry.registerPath({
  method: 'post',
  path: '/programs/{id}/merge',
  operationId: 'merge_program',
  tags: ['Programs'],
  summary: 'Merge program into another',
  description: 'Re-parents all child entities from source program to target program, archives the source with merge metadata.',
  request: {
    params: z.object({
      id: UuidSchema,
    }),
    body: {
      content: {
        'application/json': {
          schema: MergeProgramRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Updated target program after merge',
      content: {
        'application/json': {
          schema: ProgramResponseSchema,
        },
      },
    },
    400: { description: 'Invalid request (same program or archived program)' },
    404: { description: 'Program not found' },
    409: { description: 'Confirmation name does not match' },
  },
});
