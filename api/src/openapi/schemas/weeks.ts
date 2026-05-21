/**
 * Week/Sprint schemas - Sprint management with planning, review, and accountability
 */

import { z, registry } from '../registry.js';
import { UuidSchema, DateTimeSchema, DateSchema, UserReferenceSchema } from './common.js';
import { ApprovalTrackingSchema } from './projects.js';

// ============== Week/Sprint Response ==============

export const WeekResponseSchema = z.object({
  id: UuidSchema,
  name: z.string().openapi({ description: 'Sprint title' }),
  sprint_number: z.number().int().positive().openapi({
    description: 'Sprint sequence number (dates computed from workspace.sprint_start_date)',
  }),
  status: z.enum(['planning', 'active', 'completed']).openapi({
    description: 'Sprint workflow status',
  }),
  owner: UserReferenceSchema.nullable(),
  program_id: UuidSchema.nullable(),
  program_name: z.string().nullable(),
  program_prefix: z.string().nullable(),
  program_accountable_id: UuidSchema.nullable(),
  workspace_sprint_start_date: DateSchema.openapi({
    description: 'Workspace anchor date for computing sprint dates',
  }),
  // Counts
  issue_count: z.number().int(),
  completed_count: z.number().int(),
  started_count: z.number().int(),
  // Plan tracking
  has_plan: z.boolean(),
  has_retro: z.boolean(),
  retro_outcome: z.string().nullable(),
  retro_id: UuidSchema.nullable(),
  plan: z.string().nullable().openapi({
    description: 'What will we learn or validate this sprint?',
  }),
  success_criteria: z.array(z.string()).nullable(),
  confidence: z.number().int().min(0).max(100).nullable(),
  plan_history: z.array(z.object({
    plan: z.string(),
    timestamp: DateTimeSchema,
    author_id: UuidSchema,
    author_name: z.string().optional(),
  })).nullable(),
  // Completeness
  is_complete: z.boolean().nullable(),
  missing_fields: z.array(z.string()),
  // Snapshot (when sprint becomes active)
  planned_issue_ids: z.array(UuidSchema).nullable(),
  snapshot_taken_at: DateTimeSchema.nullable(),
  // Approval tracking
  plan_approval: ApprovalTrackingSchema.nullable(),
  review_approval: ApprovalTrackingSchema.nullable(),
  accountable_id: UuidSchema.nullable(),
}).openapi('Week');

registry.register('Week', WeekResponseSchema);

// ============== Create/Update Week ==============

export const CreateWeekSchema = z.object({
  program_id: UuidSchema.optional().nullable(),
  title: z.string().min(1).max(200).optional().default('Untitled'),
  sprint_number: z.number().int().positive(),
  owner_id: UuidSchema.optional(),
  plan: z.string().max(2000).optional(),
  success_criteria: z.array(z.string().max(500)).max(20).optional(),
  confidence: z.number().int().min(0).max(100).optional(),
}).openapi('CreateWeek');

registry.register('CreateWeek', CreateWeekSchema);

export const UpdateWeekSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  owner_id: UuidSchema.optional().nullable(),
  sprint_number: z.number().int().positive().optional(),
  status: z.enum(['planning', 'active', 'completed']).optional(),
}).openapi('UpdateWeek');

registry.register('UpdateWeek', UpdateWeekSchema);

export const UpdateWeekPlanSchema = z.object({
  plan: z.string().max(2000).optional(),
  success_criteria: z.array(z.string().max(500)).max(20).optional(),
  confidence: z.number().int().min(0).max(100).optional(),
}).openapi('UpdateWeekPlan');

registry.register('UpdateWeekPlan', UpdateWeekPlanSchema);

// ============== Week Review ==============

export const WeekReviewSchema = z.object({
  id: UuidSchema,
  sprint_id: UuidSchema,
  owner_id: UuidSchema,
  plan_validated: z.boolean().nullable(),
  content: z.record(z.unknown()).nullable(),
  created_at: DateTimeSchema,
  updated_at: DateTimeSchema,
}).openapi('WeekReview');

registry.register('WeekReview', WeekReviewSchema);

// ============== Active Weeks Response ==============

export const ActiveWeeksResponseSchema = z.object({
  sprints: z.array(WeekResponseSchema),
  currentSprintNumber: z.number().int(),
  daysRemaining: z.number().int().openapi({
    description: 'Days remaining in current sprint',
  }),
}).openapi('ActiveWeeksResponse');

registry.register('ActiveWeeksResponse', ActiveWeeksResponseSchema);

// ============== Register Week Endpoints ==============

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
          schema: z.object({
            id: UuidSchema,
            name: z.string(),
            sprint_number: z.number().int(),
            plan: z.string().nullable(),
            plan_validated: z.boolean().nullable(),
            issues: z.array(z.object({
              id: UuidSchema,
              title: z.string(),
              state: z.string(),
              ticket_number: z.number().int(),
              was_planned: z.boolean(),
            })),
            content: z.record(z.unknown()).nullable(),
          }),
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
