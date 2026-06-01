import { z, registry } from '../registry.js';
import { UuidSchema } from './common.js';
import {
  WeekPlanApprovalResponseSchema,
  WeekResponseSchema,
} from './weeks-schemas.js';


registry.registerPath({
  method: 'post',
  path: '/weeks/{id}/start',
  tags: ['Weeks'],
  summary: 'Start sprint',
  description: 'Transition sprint from planning to active state and take a snapshot of planned issues.',
  request: {
    params: z.object({
      id: UuidSchema,
    }),
  },
  responses: {
    200: {
      description: 'Sprint started',
      content: {
        'application/json': {
          schema: WeekResponseSchema,
        },
      },
    },
    400: {
      description: 'Sprint cannot be started (already active or completed)',
    },
    404: {
      description: 'Sprint not found',
    },
  },
});

registry.registerPath({
  method: 'post',
  path: '/weeks/{id}/carryover',
  tags: ['Weeks'],
  summary: 'Carry over incomplete issues',
  description: 'Move incomplete issues from this sprint to a target sprint.',
  request: {
    params: z.object({
      id: UuidSchema,
    }),
    body: {
      content: {
        'application/json': {
          schema: z.object({
            target_sprint_id: UuidSchema.openapi({
              description: 'Sprint to move incomplete issues to',
            }),
            issue_ids: z.array(UuidSchema).optional().openapi({
              description: 'Specific issues to move (defaults to all incomplete)',
            }),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Issues carried over',
      content: {
        'application/json': {
          schema: z.object({
            moved_count: z.number().int(),
            moved_issues: z.array(z.object({
              id: UuidSchema,
              title: z.string(),
              ticket_number: z.number().int(),
            })),
          }),
        },
      },
    },
    400: {
      description: 'Invalid target sprint or no issues to carry over',
    },
    404: {
      description: 'Sprint not found',
    },
  },
});

registry.registerPath({
  method: 'post',
  path: '/weeks/{id}/approve-plan',
  tags: ['Weeks'],
  summary: 'Approve sprint plan',
  description: 'Mark the sprint plan as approved by the accountable person. Optionally include a manager comment.',
  request: {
    params: z.object({
      id: UuidSchema,
    }),
    body: {
      content: {
        'application/json': {
          schema: z.object({
            comment: z.string().max(2000).optional().nullable().describe('Optional manager note to persist with approval'),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Plan approved',
      content: {
        'application/json': {
          schema: WeekPlanApprovalResponseSchema,
        },
      },
    },
    403: {
      description: 'Not authorized to approve (not the accountable person)',
    },
    404: {
      description: 'Sprint not found',
    },
  },
});

registry.registerPath({
  method: 'post',
  path: '/weeks/{id}/approve-review',
  tags: ['Weeks'],
  summary: 'Approve sprint review',
  description: 'Mark the sprint review as approved by the accountable person. Rating is required (1-5 OPM scale). Optional manager comment can be included.',
  request: {
    params: z.object({
      id: UuidSchema,
    }),
    body: {
      content: {
        'application/json': {
          schema: z.object({
            rating: z.number().int().min(1).max(5).describe('Required performance rating (1=Unacceptable, 2=Minimally Satisfactory, 3=Fully Successful, 4=Exceeds Expectations, 5=Outstanding)'),
            comment: z.string().max(2000).optional().nullable().describe('Optional manager note to persist with approval'),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Review approved',
      content: {
        'application/json': {
          schema: WeekResponseSchema,
        },
      },
    },
    403: {
      description: 'Not authorized to approve (not the accountable person)',
    },
    404: {
      description: 'Sprint not found',
    },
  },
});

registry.registerPath({
  method: 'post',
  path: '/weeks/{id}/request-plan-changes',
  tags: ['Weeks'],
  summary: 'Request changes on sprint plan',
  description: 'Request changes on the sprint plan. Requires feedback text explaining what needs to change. Sets plan_approval.state to changes_requested.',
  request: {
    params: z.object({
      id: UuidSchema,
    }),
    body: {
      content: {
        'application/json': {
          schema: z.object({
            feedback: z.string().min(1).describe('Feedback explaining what changes are needed'),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Changes requested on plan',
      content: {
        'application/json': {
          schema: WeekResponseSchema,
        },
      },
    },
    400: {
      description: 'Feedback is required',
    },
    403: {
      description: 'Not authorized (not the accountable person)',
    },
    404: {
      description: 'Sprint not found',
    },
  },
});

registry.registerPath({
  method: 'post',
  path: '/weeks/{id}/request-retro-changes',
  tags: ['Weeks'],
  summary: 'Request changes on sprint retro',
  description: 'Request changes on the sprint retro. Requires feedback text explaining what needs to change. Sets review_approval.state to changes_requested.',
  request: {
    params: z.object({
      id: UuidSchema,
    }),
    body: {
      content: {
        'application/json': {
          schema: z.object({
            feedback: z.string().min(1).describe('Feedback explaining what changes are needed'),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Changes requested on retro',
      content: {
        'application/json': {
          schema: WeekResponseSchema,
        },
      },
    },
    400: {
      description: 'Feedback is required',
    },
    403: {
      description: 'Not authorized (not the accountable person)',
    },
    404: {
      description: 'Sprint not found',
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/weeks/{id}/scope-changes',
  tags: ['Weeks'],
  summary: 'Get sprint scope changes',
  description: 'Get issues added or removed after sprint was started.',
  request: {
    params: z.object({
      id: UuidSchema,
    }),
  },
  responses: {
    200: {
      description: 'Scope changes',
      content: {
        'application/json': {
          schema: z.object({
            planned_at_start: z.array(z.object({
              id: UuidSchema,
              title: z.string(),
              state: z.string(),
              ticket_number: z.number().int(),
            })),
            added_after_start: z.array(z.object({
              id: UuidSchema,
              title: z.string(),
              state: z.string(),
              ticket_number: z.number().int(),
              added_at: z.string(),
            })),
            removed_after_start: z.array(z.object({
              id: UuidSchema,
              title: z.string(),
              ticket_number: z.number().int(),
              removed_at: z.string(),
            })),
          }),
        },
      },
    },
    404: {
      description: 'Sprint not found',
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/weeks/lookup',
  tags: ['Weeks'],
  summary: 'Lookup week by sprint number',
  request: { query: z.object({ sprint_number: z.coerce.number().int(), program_id: UuidSchema.optional() }) },
  responses: { 200: { description: 'Week lookup result', content: { 'application/json': { schema: WeekResponseSchema } } } },
});

registry.registerPath({
  method: 'get',
  path: '/weeks/lookup-person',
  tags: ['Weeks'],
  summary: 'Lookup week for a person',
  request: { query: z.object({ person_id: UuidSchema, sprint_number: z.coerce.number().int().optional() }) },
  responses: { 200: { description: 'Person week lookup', content: { 'application/json': { schema: z.record(z.unknown()) } } } },
});

registry.registerPath({
  method: 'get',
  path: '/weeks/my-week',
  tags: ['Weeks'],
  summary: 'Get current user week dashboard',
  responses: { 200: { description: 'My week data', content: { 'application/json': { schema: z.record(z.unknown()) } } } },
});

registry.registerPath({
  method: 'get',
  path: '/weeks/my-action-items',
  tags: ['Weeks'],
  summary: 'Get current user action items',
  responses: { 200: { description: 'Action items', content: { 'application/json': { schema: z.record(z.unknown()) } } } },
});

registry.registerPath({
  method: 'post',
  path: '/weeks/{id}/unapprove-plan',
  tags: ['Weeks'],
  summary: 'Unapprove week plan',
  request: { params: z.object({ id: UuidSchema }) },
  responses: { 200: { description: 'Plan unapproved' }, 404: { description: 'Week not found' } },
});

registry.registerPath({
  method: 'get',
  path: '/weeks/{id}/iterations',
  tags: ['Weeks'],
  summary: 'List week iterations',
  request: { params: z.object({ id: UuidSchema }) },
  responses: { 200: { description: 'Iterations', content: { 'application/json': { schema: z.array(z.record(z.unknown())) } } } },
});

registry.registerPath({
  method: 'post',
  path: '/weeks/{id}/iterations',
  tags: ['Weeks'],
  summary: 'Create week iteration',
  request: {
    params: z.object({ id: UuidSchema }),
    body: { content: { 'application/json': { schema: z.record(z.unknown()) } } },
  },
  responses: { 201: { description: 'Iteration created' }, 404: { description: 'Week not found' } },
});

