/**
 * Issue schemas - Full issue CRUD with state, priority, and associations
 */

import { z, registry } from '../registry.js';
import {
  accountabilityTypeSchema,
  createIssueRequestSchema,
  issuePrioritySchema,
  issueStateSchema,
  updateIssueRequestSchema,
} from '../../schemas/document-boundary.js';
import { UuidSchema, DateTimeSchema, DateSchema, BelongsToResponseSchema, UserReferenceSchema, IssueSourceSchema } from './common.js';

// ============== Issue Enums ==============

export const IssueStateSchema = issueStateSchema.openapi({
  description: 'Issue workflow state',
});

registry.register('IssueState', IssueStateSchema);

export const IssuePrioritySchema = issuePrioritySchema.openapi({
  description: 'Issue priority level',
});

registry.register('IssuePriority', IssuePrioritySchema);

export const AccountabilityTypeSchema = accountabilityTypeSchema.openapi({
  description: 'Type of accountability task for auto-generated issues',
});

// ============== Issue Response ==============

export const IssueResponseSchema = z.object({
  id: UuidSchema,
  title: z.string(),
  display_id: z.string().openapi({
    description: 'Human-readable ticket ID (e.g., "#42")',
    example: '#42',
  }),
  ticket_number: z.number().int().openapi({
    description: 'Numeric ticket number',
    example: 42,
  }),
  state: IssueStateSchema,
  priority: IssuePrioritySchema,
  assignee_id: UuidSchema.nullable(),
  assignee_name: z.string().nullable().openapi({
    description: 'Name of assigned user',
  }),
  assignee_archived: z.boolean().optional().openapi({
    description: 'Whether the assigned user has been archived',
  }),
  estimate: z.number().positive().nullable().openapi({
    description: 'Time estimate in hours',
  }),
  source: IssueSourceSchema,
  due_date: DateSchema.nullable().optional(),
  is_system_generated: z.boolean().optional().openapi({
    description: 'Whether this issue was auto-generated for accountability',
  }),
  accountability_target_id: UuidSchema.nullable().optional(),
  accountability_type: AccountabilityTypeSchema.nullable().optional(),
  rejection_reason: z.string().nullable().optional().openapi({
    description: 'Reason if issue was rejected from triage',
  }),
  content: z.record(z.unknown()).nullable(),
  created_at: DateTimeSchema,
  updated_at: DateTimeSchema,
  created_by: UuidSchema.optional(),
  created_by_name: z.string().optional(),
  started_at: DateTimeSchema.nullable().optional(),
  completed_at: DateTimeSchema.nullable().optional(),
  cancelled_at: DateTimeSchema.nullable().optional(),
  reopened_at: DateTimeSchema.nullable().optional(),
  converted_from_id: UuidSchema.nullable().optional().openapi({
    description: 'ID of document this issue was converted from',
  }),
  belongs_to: z.array(BelongsToResponseSchema).openapi({
    description: 'Associated documents (programs, projects, sprints, parent issues)',
  }),
}).openapi('Issue');

registry.register('Issue', IssueResponseSchema);

// ============== Create Issue ==============

export const CreateIssueSchema = createIssueRequestSchema.openapi('CreateIssue');

registry.register('CreateIssue', CreateIssueSchema);

// ============== Update Issue ==============

export const UpdateIssueSchema = updateIssueRequestSchema.openapi('UpdateIssue');

registry.register('UpdateIssue', UpdateIssueSchema);

// ============== Bulk Update ==============

export const BulkUpdateIssuesSchema = z.object({
  ids: z.array(UuidSchema).min(1).max(100),
  action: z.enum(['archive', 'delete', 'restore', 'update']),
  updates: z.object({
    state: IssueStateSchema.optional(),
    sprint_id: UuidSchema.nullable().optional(),
    assignee_id: UuidSchema.nullable().optional(),
    project_id: UuidSchema.nullable().optional(),
  }).optional(),
}).openapi('BulkUpdateIssues');

registry.register('BulkUpdateIssues', BulkUpdateIssuesSchema);

// ============== Issue History ==============

export const IssueHistoryEntrySchema = z.object({
  id: UuidSchema,
  field: z.string().openapi({ description: 'Field that was changed' }),
  old_value: z.string().nullable(),
  new_value: z.string().nullable(),
  created_at: DateTimeSchema,
  changed_by: UserReferenceSchema.nullable(),
  automated_by: z.string().optional().openapi({
    description: 'Automation source (e.g., "claude")',
  }),
}).openapi('IssueHistoryEntry');

registry.register('IssueHistoryEntry', IssueHistoryEntrySchema);

// ============== Issue Iteration ==============

export const IssueIterationSchema = z.object({
  id: UuidSchema,
  issue_id: UuidSchema,
  status: z.enum(['pass', 'fail', 'in_progress']),
  what_attempted: z.string().max(5000).nullable().optional(),
  blockers_encountered: z.string().max(5000).nullable().optional(),
  author: UserReferenceSchema,
  created_at: DateTimeSchema,
  updated_at: DateTimeSchema,
}).openapi('IssueIteration');

registry.register('IssueIteration', IssueIterationSchema);

// ============== Cascade Warning (409 response) ==============

export const IncompleteChildrenWarningSchema = z.object({
  error: z.literal('incomplete_children'),
  message: z.string(),
  incomplete_children: z.array(z.object({
    id: UuidSchema,
    title: z.string(),
    ticket_number: z.number().int(),
    state: IssueStateSchema,
  })),
  confirm_action: z.string(),
}).openapi('IncompleteChildrenWarning');

registry.register('IncompleteChildrenWarning', IncompleteChildrenWarningSchema);

// ============== Register Issue Endpoints ==============

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
          schema: z.array(IssueResponseSchema),
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
  description: 'Delete an issue. System-generated accountability issues cannot be deleted.',
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
          schema: z.object({
            updated: z.array(IssueResponseSchema),
            failed: z.array(z.object({
              id: UuidSchema,
              error: z.string(),
            })),
          }),
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
