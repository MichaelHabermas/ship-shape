import { z, registry } from '../registry.js';
import { UuidSchema, DateSchema, IssueSourceSchema } from './common.js';
import {
  AccountabilityTypeSchema,
  BulkUpdateIssuesResponseSchema,
  BulkUpdateIssuesSchema,
  CreateIssueSchema,
  IncompleteChildrenWarningSchema,
  IssueHistoryEntrySchema,
  IssueIterationSchema,
  IssueListResponseSchema,
  IssuePrioritySchema,
  IssueResponseSchema,
  IssueStateSchema,
  UpdateIssueSchema,
} from './issues-schemas.js';

registry.registerPath({
  method: 'get',
  path: '/issues',
  tags: ['Issues'],
  summary: 'List issues',
  description: 'List issues with optional filtering by state, priority, assignee, program, project, sprint, and more.',
  request: {
    query: z.object({
      state: z.string().optional().openapi({
        description: 'Filter by state(s), comma-separated',
        example: 'backlog,todo,in_progress',
      }),
      priority: IssuePrioritySchema.optional(),
      assignee_id: z.string().optional().openapi({
        description: 'Filter by assignee ID. Use "null" or "unassigned" for unassigned issues.',
      }),
      program_id: UuidSchema.optional(),
      project_id: UuidSchema.optional(),
      sprint_id: UuidSchema.optional(),
      source: IssueSourceSchema.optional(),
      parent_filter: z.enum(['top_level', 'has_children', 'is_sub_issue']).optional().openapi({
        description: 'Filter by parent/child relationship',
      }),
    }),
  },
  responses: {
    200: {
      description: 'List of issues',
      content: {
        'application/json': {
          schema: z.array(IssueListResponseSchema),
        },
      },
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/issues/{id}',
  tags: ['Issues'],
  summary: 'Get issue by ID',
  request: {
    params: z.object({
      id: UuidSchema,
    }),
  },
  responses: {
    200: {
      description: 'Issue details',
      content: {
        'application/json': {
          schema: IssueResponseSchema,
        },
      },
    },
    301: {
      description: 'Issue was converted to another document type',
      headers: z.object({
        Location: z.string().openapi({ description: 'URL to the new document' }),
        'X-Converted-Type': z.string().openapi({ description: 'New document type' }),
        'X-Converted-To': z.string().openapi({ description: 'New document ID' }),
      }),
    },
    404: {
      description: 'Issue not found',
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/issues/by-ticket/{number}',
  tags: ['Issues'],
  summary: 'Get issue by ticket number',
  description: 'Retrieve an issue by its human-readable ticket number (e.g., 42 for #42).',
  request: {
    params: z.object({
      number: z.coerce.number().int().openapi({
        description: 'Ticket number (without the # prefix)',
        example: 42,
      }),
    }),
  },
  responses: {
    200: {
      description: 'Issue details',
      content: {
        'application/json': {
          schema: IssueResponseSchema,
        },
      },
    },
    301: {
      description: 'Issue was converted to another document type',
    },
    404: {
      description: 'Issue not found',
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/issues/{id}/children',
  tags: ['Issues'],
  summary: 'Get sub-issues',
  description: 'Get all sub-issues (children) of a parent issue.',
  request: {
    params: z.object({
      id: UuidSchema,
    }),
  },
  responses: {
    200: {
      description: 'List of sub-issues',
      content: {
        'application/json': {
          schema: z.array(IssueResponseSchema),
        },
      },
    },
    404: {
      description: 'Parent issue not found',
    },
  },
});

registry.registerPath({
  method: 'post',
  path: '/issues',
  tags: ['Issues'],
  summary: 'Create issue',
  request: {
    body: {
      content: {
        'application/json': {
          schema: CreateIssueSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Created issue',
      content: {
        'application/json': {
          schema: IssueResponseSchema,
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
  path: '/issues/{id}',
  tags: ['Issues'],
  summary: 'Update issue',
  request: {
    params: z.object({
      id: UuidSchema,
    }),
    body: {
      content: {
        'application/json': {
          schema: UpdateIssueSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Updated issue',
      content: {
        'application/json': {
          schema: IssueResponseSchema,
        },
      },
    },
    400: {
      description: 'Validation error or estimate required for sprint assignment',
    },
    404: {
      description: 'Issue not found',
    },
    409: {
      description: 'Cannot close parent issue with incomplete children',
      content: {
        'application/json': {
          schema: IncompleteChildrenWarningSchema,
        },
      },
    },
  },
});

registry.registerPath({
  method: 'delete',
  path: '/issues/{id}',
  tags: ['Issues'],
  summary: 'Delete issue',
  description: 'Soft-delete an issue. System-generated accountability issues cannot be deleted.',
  request: {
    params: z.object({
      id: UuidSchema,
    }),
  },
  responses: {
    204: {
      description: 'Issue deleted',
    },
    403: {
      description: 'Cannot delete system-generated accountability issues',
    },
    404: {
      description: 'Issue not found',
    },
  },
});

registry.registerPath({
  method: 'post',
  path: '/issues/bulk',
  tags: ['Issues'],
  summary: 'Bulk update issues',
  description: 'Perform bulk operations on multiple issues (archive, delete, restore, update).',
  request: {
    body: {
      content: {
        'application/json': {
          schema: BulkUpdateIssuesSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Bulk operation result',
      content: {
        'application/json': {
          schema: BulkUpdateIssuesResponseSchema,
        },
      },
    },
  },
});

registry.registerPath({
  method: 'post',
  path: '/issues/{id}/accept',
  tags: ['Issues'],
  summary: 'Accept issue from triage',
  description: 'Move an issue from triage state to backlog.',
  request: {
    params: z.object({
      id: UuidSchema,
    }),
  },
  responses: {
    200: {
      description: 'Issue accepted',
      content: {
        'application/json': {
          schema: IssueResponseSchema,
        },
      },
    },
    400: {
      description: 'Issue must be in triage state',
    },
    404: {
      description: 'Issue not found',
    },
  },
});

registry.registerPath({
  method: 'post',
  path: '/issues/{id}/reject',
  tags: ['Issues'],
  summary: 'Reject issue from triage',
  description: 'Reject an issue from triage state to cancelled with a reason.',
  request: {
    params: z.object({
      id: UuidSchema,
    }),
    body: {
      content: {
        'application/json': {
          schema: z.object({
            reason: z.string().min(1).max(1000).openapi({
              description: 'Reason for rejecting the issue',
            }),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Issue rejected',
      content: {
        'application/json': {
          schema: IssueResponseSchema,
        },
      },
    },
    400: {
      description: 'Issue must be in triage state or reason is required',
    },
    404: {
      description: 'Issue not found',
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/issues/{id}/history',
  tags: ['Issues'],
  summary: 'Get issue history',
  description: 'Get the change history for an issue.',
  request: {
    params: z.object({
      id: UuidSchema,
    }),
  },
  responses: {
    200: {
      description: 'Issue history',
      content: {
        'application/json': {
          schema: z.array(IssueHistoryEntrySchema),
        },
      },
    },
    400: {
      description: 'Validation error',
    },
    403: {
      description: 'Forbidden',
    },
    404: {
      description: 'Issue not found',
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/issues/{id}/iterations',
  tags: ['Issues'],
  summary: 'Get issue iterations',
  description: 'Get Claude work iterations for an issue.',
  request: {
    params: z.object({
      id: UuidSchema,
    }),
    query: z.object({
      status: z.enum(['pass', 'fail', 'in_progress']).optional(),
    }),
  },
  responses: {
    200: {
      description: 'Issue iterations',
      content: {
        'application/json': {
          schema: z.array(IssueIterationSchema),
        },
      },
    },
    404: {
      description: 'Issue not found',
    },
  },
});

registry.registerPath({
  method: 'post',
  path: '/issues/{id}/iterations',
  tags: ['Issues'],
  summary: 'Create issue iteration',
  description: 'Log a Claude work iteration for an issue.',
  request: {
    params: z.object({
      id: UuidSchema,
    }),
    body: {
      required: true,
      content: {
        'application/json': {
          schema: z.object({
            status: z.enum(['pass', 'fail', 'in_progress']),
            what_attempted: z.string().max(5000).optional(),
            blockers_encountered: z.string().max(5000).optional(),
          }),
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Created iteration',
      content: {
        'application/json': {
          schema: IssueIterationSchema,
        },
      },
    },
    400: {
      description: 'Validation error',
    },
    403: {
      description: 'Forbidden',
    },
    404: {
      description: 'Issue not found',
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/issues/action-items',
  tags: ['Issues'],
  summary: 'Get action items',
  description: 'Get accountability action items for the current user.',
  responses: {
    200: {
      description: 'Action items list',
      content: {
        'application/json': {
          schema: z.object({
            items: z.array(z.object({
              id: UuidSchema,
              title: z.string(),
              state: IssueStateSchema,
              priority: IssuePrioritySchema,
              ticket_number: z.number().int(),
              display_id: z.string(),
              due_date: DateSchema.nullable(),
              is_system_generated: z.boolean(),
              accountability_type: AccountabilityTypeSchema.nullable(),
              accountability_target_id: UuidSchema.nullable(),
              target_title: z.string().nullable(),
              days_overdue: z.number().int(),
            })),
            total: z.number().int(),
          }),
        },
      },
    },
  },
});

registry.registerPath({
  method: 'post',
  path: '/issues/{id}/history',
  tags: ['Issues'],
  summary: 'Append issue history entry',
  request: {
    params: z.object({ id: UuidSchema }),
    body: {
      content: {
        'application/json': {
          schema: z.object({
            field: z.string(),
            old_value: z.unknown().optional(),
            new_value: z.unknown().optional(),
          }).passthrough(),
        },
      },
    },
  },
  responses: {
    201: { description: 'History entry created' },
    404: { description: 'Issue not found' },
  },
});
