// Team OpenAPI schemas describe people, allocation, assignments, and review grids.
import { z, registry } from '../registry.js';
import { UuidSchema, DateSchema } from './common.js';
import { ApprovalTrackingSchema } from './projects.js';

// ============== Person ==============

export const PersonSchema = z.object({
  personId: UuidSchema.openapi({ description: 'Person document ID (used for allocations)' }),
  id: UuidSchema.nullable().openapi({ description: 'User ID (null for pending users)' }),
  name: z.string(),
  email: z.string().email().nullable(),
  isArchived: z.boolean(),
  isPending: z.boolean().openapi({ description: 'User has not accepted invite yet' }),
  reportsTo: UuidSchema.nullable().optional(),
}).openapi('Person');

registry.register('Person', PersonSchema);

/** Person row returned by GET /team/people (document id in `id`, user id in `user_id`). */
export const TeamPersonListItemSchema = z.object({
  id: UuidSchema.openapi({ description: 'Person document ID' }),
  user_id: UuidSchema.nullable(),
  name: z.string(),
  email: z.string().email().nullable(),
  isArchived: z.boolean(),
  isPending: z.boolean(),
  reportsTo: UuidSchema.nullable().optional(),
  role: z.string().nullable().optional(),
}).openapi('TeamPersonListItem');

registry.register('TeamPersonListItem', TeamPersonListItemSchema);

// ============== Sprint Period ==============

export const SprintPeriodSchema = z.object({
  number: z.number().int(),
  name: z.string().openapi({ example: 'Week 5' }),
  startDate: DateSchema,
  endDate: DateSchema,
  isCurrent: z.boolean(),
}).openapi('SprintPeriod');

registry.register('SprintPeriod', SprintPeriodSchema);

// ============== Team Grid ==============

export const TeamGridAssociationSchema = z.object({
  programs: z.array(z.object({
    id: UuidSchema,
    name: z.string(),
    emoji: z.string().nullable(),
    color: z.string(),
    issueCount: z.number().int(),
  })),
  issues: z.array(z.object({
    id: UuidSchema,
    title: z.string(),
    displayId: z.string(),
    state: z.string(),
  })),
}).openapi('TeamGridAssociation');

export const TeamGridResponseSchema = z.object({
  users: z.array(PersonSchema),
  weeks: z.array(SprintPeriodSchema),
  associations: z.record(z.record(TeamGridAssociationSchema)).openapi({
    description: 'Map of user_id -> sprint_number -> associations',
  }),
  currentSprintNumber: z.number().int(),
}).openapi('TeamGridResponse');

registry.register('TeamGridResponse', TeamGridResponseSchema);

export const TeamAssignmentSchema = z.object({
  projectId: UuidSchema.nullable(),
  projectName: z.string().nullable(),
  projectColor: z.string().nullable(),
  programId: UuidSchema.nullable(),
  programName: z.string().nullable(),
  emoji: z.string().nullable(),
  color: z.string().nullable(),
}).openapi('TeamAssignment');

registry.register('TeamAssignment', TeamAssignmentSchema);

export const TeamAssignmentsResponseSchema = z.record(z.record(TeamAssignmentSchema)).openapi('TeamAssignmentsResponse');

registry.register('TeamAssignmentsResponse', TeamAssignmentsResponseSchema);

export const TeamAssignRequestSchema = z.object({
  personId: UuidSchema.optional(),
  userId: UuidSchema.optional(),
  projectId: UuidSchema.optional(),
  programId: UuidSchema.optional(),
  sprintNumber: z.number().int(),
}).openapi('TeamAssignRequest');

registry.register('TeamAssignRequest', TeamAssignRequestSchema);

export const TeamUnassignRequestSchema = z.object({
  personId: UuidSchema.optional(),
  userId: UuidSchema.optional(),
  sprintNumber: z.number().int(),
}).openapi('TeamUnassignRequest');

registry.register('TeamUnassignRequest', TeamUnassignRequestSchema);

export const TeamAssignResponseSchema = z.object({
  success: z.literal(true),
  sprintId: UuidSchema,
}).openapi('TeamAssignResponse');

registry.register('TeamAssignResponse', TeamAssignResponseSchema);

export const TeamUnassignResponseSchema = z.object({
  success: z.literal(true),
}).openapi('TeamUnassignResponse');

registry.register('TeamUnassignResponse', TeamUnassignResponseSchema);

export const TeamAssignmentErrorSchema = z.object({
  error: z.string(),
  issuesOrphaned: z.array(z.object({
    id: UuidSchema,
    title: z.string(),
  })).optional(),
}).openapi('TeamAssignmentError');

registry.register('TeamAssignmentError', TeamAssignmentErrorSchema);

// ============== Review Cell ==============

export const ReviewCellSchema = z.object({
  planApproval: ApprovalTrackingSchema.nullable(),
  reviewApproval: ApprovalTrackingSchema.nullable(),
  reviewRating: z.object({
    value: z.number().int().min(1).max(5),
    rated_by: UuidSchema,
    rated_at: z.string(),
  }).nullable(),
  hasPlan: z.boolean(),
  hasRetro: z.boolean(),
  sprintId: UuidSchema.nullable(),
  planDocId: UuidSchema.nullable(),
  retroDocId: UuidSchema.nullable(),
}).openapi('ReviewCell');

registry.register('ReviewCell', ReviewCellSchema);

export const ReviewsResponseSchema = z.object({
  people: z.array(z.object({
    personId: UuidSchema,
    name: z.string(),
    programId: UuidSchema.nullable(),
    programName: z.string().nullable(),
    programColor: z.string().nullable(),
    reportsTo: UuidSchema.nullable().optional(),
  })),
  weeks: z.array(SprintPeriodSchema),
  reviews: z.record(z.record(ReviewCellSchema)).openapi({
    description: 'Map of personId -> sprintNumber -> review cell data',
  }),
  currentSprintNumber: z.number().int(),
}).openapi('ReviewsResponse');

registry.register('ReviewsResponse', ReviewsResponseSchema);

// ============== Register Team Endpoints ==============

registry.registerPath({
  method: 'get',
  path: '/team/reviews',
  tags: ['Team'],
  summary: 'Get manager review grid',
  description: 'Get person-by-week matrix of plan approval status, review approval status, and performance ratings.',
  operationId: 'get_team_reviews',
  request: {
    query: z.object({
      sprint_count: z.coerce.number().int().min(1).max(20).optional().openapi({
        description: 'Number of weeks to include (default: 5)',
      }),
      showArchived: z.coerce.boolean().optional(),
    }),
  },
  responses: {
    200: {
      description: 'Manager review grid data',
      content: {
        'application/json': {
          schema: ReviewsResponseSchema,
        },
      },
    },
    403: {
      description: 'Admin access required',
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/team/grid',
  tags: ['Team'],
  summary: 'Get team grid data',
  description: 'Get team members with their sprint associations for the allocation grid.',
  request: {
    query: z.object({
      fromSprint: z.coerce.number().int().optional().openapi({
        description: 'Start of sprint range (default: current - 7)',
      }),
      toSprint: z.coerce.number().int().optional().openapi({
        description: 'End of sprint range (default: current + 7)',
      }),
      includeArchived: z.coerce.boolean().optional().openapi({
        description: 'Include archived team members',
      }),
    }),
  },
  responses: {
    200: {
      description: 'Team grid data',
      content: {
        'application/json': {
          schema: TeamGridResponseSchema,
        },
      },
    },
  },
});

const TeamJsonResponseSchema = z.record(z.unknown());

registry.registerPath({
  method: 'get',
  path: '/team/projects',
  tags: ['Team'],
  summary: 'List team projects',
  responses: { 200: { description: 'Projects', content: { 'application/json': { schema: TeamJsonResponseSchema } } } },
});

registry.registerPath({
  method: 'get',
  path: '/team/programs',
  tags: ['Team'],
  summary: 'List team programs',
  responses: { 200: { description: 'Programs', content: { 'application/json': { schema: TeamJsonResponseSchema } } } },
});

registry.registerPath({
  method: 'get',
  path: '/team/assignments',
  tags: ['Team'],
  summary: 'List team assignments',
  responses: { 200: { description: 'Assignments', content: { 'application/json': { schema: TeamAssignmentsResponseSchema } } } },
});

registry.registerPath({
  method: 'post',
  path: '/team/assign',
  tags: ['Team'],
  summary: 'Create team assignment',
  request: { body: { content: { 'application/json': { schema: TeamAssignRequestSchema } } } },
  responses: {
    200: { description: 'Assignment created', content: { 'application/json': { schema: TeamAssignResponseSchema } } },
    400: { description: 'Invalid assignment request', content: { 'application/json': { schema: TeamAssignmentErrorSchema } } },
    403: { description: 'Assignment forbidden', content: { 'application/json': { schema: TeamAssignmentErrorSchema } } },
  },
});

registry.registerPath({
  method: 'delete',
  path: '/team/assign',
  tags: ['Team'],
  summary: 'Remove team assignment',
  request: { body: { content: { 'application/json': { schema: TeamUnassignRequestSchema } } } },
  responses: {
    200: { description: 'Assignment removed', content: { 'application/json': { schema: TeamUnassignResponseSchema } } },
    400: { description: 'Invalid unassignment request', content: { 'application/json': { schema: TeamAssignmentErrorSchema } } },
    403: { description: 'Unassignment forbidden', content: { 'application/json': { schema: TeamAssignmentErrorSchema } } },
    404: { description: 'Assignment not found', content: { 'application/json': { schema: TeamAssignmentErrorSchema } } },
  },
});

registry.registerPath({
  method: 'get',
  path: '/team/people',
  tags: ['Team'],
  summary: 'List team people',
  responses: {
    200: {
      description: 'People',
      content: { 'application/json': { schema: z.array(TeamPersonListItemSchema) } },
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/team/people/{personId}/sprint-metrics',
  tags: ['Team'],
  summary: 'Get person sprint metrics',
  request: { params: z.object({ personId: UuidSchema }) },
  responses: { 200: { description: 'Sprint metrics', content: { 'application/json': { schema: TeamJsonResponseSchema } } } },
});

registry.registerPath({
  method: 'get',
  path: '/team/accountability',
  tags: ['Team'],
  summary: 'Get team accountability data',
  responses: { 200: { description: 'Accountability data', content: { 'application/json': { schema: TeamJsonResponseSchema } } } },
});

registry.registerPath({
  method: 'get',
  path: '/team/accountability-grid-v3',
  tags: ['Team'],
  summary: 'Get accountability grid (v3)',
  responses: { 200: { description: 'Accountability grid v3', content: { 'application/json': { schema: TeamJsonResponseSchema } } } },
});
