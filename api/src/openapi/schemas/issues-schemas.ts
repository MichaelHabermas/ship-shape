// Issue OpenAPI schemas describe issue CRUD, bulk operations, history, and iteration contracts.
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

export const IssueListResponseSchema = IssueResponseSchema
  .omit({ content: true, ticket_number: true, display_id: true, assignee_id: true, assignee_name: true, estimate: true })
  .extend({
    ticket_number: z.number().int().optional(),
    display_id: z.string().optional(),
    assignee_id: UuidSchema.optional(),
    assignee_name: z.string().optional(),
    estimate: z.number().positive().optional(),
    created_at: DateTimeSchema.optional(),
    belongs_to: z.array(BelongsToResponseSchema).optional().openapi({
      description: 'Associated documents when present; omitted for issues with no associations.',
    }),
  })
  .openapi('IssueListItem');

registry.register('Issue', IssueResponseSchema);
registry.register('IssueListItem', IssueListResponseSchema);

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

export const BulkUpdatedIssueSchema = IssueListResponseSchema.extend({
  belongs_to: z.array(BelongsToResponseSchema).openapi({
    description: 'Refreshed associated documents after the bulk operation.',
  }),
  archived_at: DateTimeSchema.nullable().optional(),
  deleted_at: DateTimeSchema.nullable().optional(),
}).openapi('BulkUpdatedIssue');

export const BulkUpdateIssuesResponseSchema = z.object({
  updated: z.array(BulkUpdatedIssueSchema),
  failed: z.array(z.object({
    id: UuidSchema,
    error: z.string(),
  })),
}).openapi('BulkUpdateIssuesResponse');

registry.register('BulkUpdatedIssue', BulkUpdatedIssueSchema);
registry.register('BulkUpdateIssuesResponse', BulkUpdateIssuesResponseSchema);

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
