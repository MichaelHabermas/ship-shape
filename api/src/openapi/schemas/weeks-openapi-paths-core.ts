import { z, registry } from '../registry.js';
import { UuidSchema, DateSchema } from './common.js';
import {
  ActiveWeeksResponseSchema,
  ActiveWeekItemSchema,
  CreateWeekSchema,
  SprintReviewResponseSchema,
  UpdateWeekPlanSchema,
  UpdateWeekSchema,
  WeekPlanApprovalResponseSchema,
  WeekResponseSchema,
  WeekReviewSchema,
} from './weeks-schemas.js';

registry.registerPath({
  method: 'get',
  path: '/weeks',
  tags: ['Weeks'],
  summary: 'Get active weeks',
  description: 'Get all sprints for the current sprint number based on workspace.sprint_start_date.',
  responses: {
    200: {
      description: 'Active weeks with sprint metadata',
      content: {
        'application/json': {
          schema: ActiveWeeksResponseSchema,
        },
      },
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/weeks/{id}',
  tags: ['Weeks'],
  summary: 'Get week by ID',
  request: {
    params: z.object({
      id: UuidSchema,
    }),
  },
  responses: {
    200: {
      description: 'Week details',
      content: {
        'application/json': {
          schema: WeekResponseSchema,
        },
      },
    },
    404: {
      description: 'Week not found',
    },
  },
});

registry.registerPath({
  method: 'post',
  path: '/weeks',
  tags: ['Weeks'],
  summary: 'Create week',
  request: {
    body: {
      content: {
        'application/json': {
          schema: CreateWeekSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Created week',
      content: {
        'application/json': {
          schema: WeekResponseSchema,
        },
      },
    },
    400: {
      description: 'Validation error',
    },
    409: {
      description: 'Sprint number already exists for this program',
    },
  },
});

registry.registerPath({
  method: 'patch',
  path: '/weeks/{id}',
  tags: ['Weeks'],
  summary: 'Update week',
  request: {
    params: z.object({
      id: UuidSchema,
    }),
    body: {
      content: {
        'application/json': {
          schema: UpdateWeekSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Updated week',
      content: {
        'application/json': {
          schema: WeekResponseSchema,
        },
      },
    },
    404: {
      description: 'Week not found',
    },
  },
});

registry.registerPath({
  method: 'patch',
  path: '/weeks/{id}/plan',
  tags: ['Weeks'],
  summary: 'Update week plan',
  description: 'Update sprint hypothesis/plan. Changes are appended to plan_history.',
  request: {
    params: z.object({
      id: UuidSchema,
    }),
    body: {
      content: {
        'application/json': {
          schema: UpdateWeekPlanSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Updated week with plan',
      content: {
        'application/json': {
          schema: WeekResponseSchema,
        },
      },
    },
    404: {
      description: 'Week not found',
    },
  },
});

registry.registerPath({
  method: 'delete',
  path: '/weeks/{id}',
  tags: ['Weeks'],
  summary: 'Delete week',
  request: {
    params: z.object({
      id: UuidSchema,
    }),
  },
  responses: {
    204: {
      description: 'Week deleted',
    },
    404: {
      description: 'Week not found',
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/weeks/{id}/review',
  tags: ['Weeks'],
  summary: 'Get week review',
  description: 'Get pre-filled review data for a sprint including issues and outcomes.',
  request: {
    params: z.object({
      id: UuidSchema,
    }),
  },
  responses: {
    200: {
      description: 'Week review data',
      content: {
        'application/json': {
          schema: SprintReviewResponseSchema,
        },
      },
    },
    404: {
      description: 'Week not found',
    },
  },
});

registry.registerPath({
  method: 'patch',
  path: '/weeks/{id}/review',
  tags: ['Weeks'],
  summary: 'Update week review',
  request: {
    params: z.object({
      id: UuidSchema,
    }),
    body: {
      content: {
        'application/json': {
          schema: z.object({
            plan_validated: z.boolean().nullable().optional(),
            content: z.record(z.unknown()).optional(),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Updated week review',
      content: {
        'application/json': {
          schema: SprintReviewResponseSchema,
        },
      },
    },
    403: {
      description: 'Not the review owner',
    },
    404: {
      description: 'Week not found',
    },
  },
});

registry.registerPath({
  method: 'post',
  path: '/weeks/{id}/review',
  tags: ['Weeks'],
  summary: 'Create week review',
  request: {
    params: z.object({
      id: UuidSchema,
    }),
    body: {
      content: {
        'application/json': {
          schema: z.object({
            plan_validated: z.boolean().nullable().optional(),
            content: z.record(z.unknown()).optional(),
          }),
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Created week review',
      content: {
        'application/json': {
          schema: SprintReviewResponseSchema,
        },
      },
    },
    409: {
      description: 'Review already exists',
    },
    404: {
      description: 'Week not found',
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/weeks/{id}/issues',
  tags: ['Weeks'],
  summary: 'Get sprint issues',
  description: 'Get all issues assigned to this sprint.',
  request: {
    params: z.object({
      id: UuidSchema,
    }),
    query: z.object({
      state: z.string().optional(),
    }),
  },
  responses: {
    200: {
      description: 'List of sprint issues',
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
            was_planned: z.boolean().optional(),
          })),
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
  path: '/weeks/{id}/standups',
  tags: ['Weeks'],
  summary: 'Get sprint standups',
  description: 'Get all standups posted for this sprint.',
  request: {
    params: z.object({
      id: UuidSchema,
    }),
    query: z.object({
      limit: z.coerce.number().int().min(1).max(100).optional(),
    }),
  },
  responses: {
    200: {
      description: 'List of standups',
      content: {
        'application/json': {
          schema: z.array(z.object({
            id: UuidSchema,
            title: z.string(),
            content: z.record(z.unknown()).nullable(),
            author_id: UuidSchema,
            author_name: z.string(),
            created_at: z.string(),
          })),
        },
      },
    },
    404: {
      description: 'Sprint not found',
    },
  },
});

registry.registerPath({
  method: 'post',
  path: '/weeks/{id}/standups',
  tags: ['Weeks'],
  summary: 'Create standup for sprint',
  description: 'Post a standup update for this sprint.',
  request: {
    params: z.object({
      id: UuidSchema,
    }),
    body: {
      content: {
        'application/json': {
          schema: z.object({
            title: z.string().max(200).optional(),
            content: z.record(z.unknown()).optional(),
          }),
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Created standup',
      content: {
        'application/json': {
          schema: z.object({
            id: UuidSchema,
            title: z.string(),
            content: z.record(z.unknown()).nullable(),
            author_id: UuidSchema,
            created_at: z.string(),
          }),
        },
      },
    },
    404: {
      description: 'Sprint not found',
    },
  },
});
