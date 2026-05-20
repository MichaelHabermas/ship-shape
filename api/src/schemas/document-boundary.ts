import { z } from 'zod';
import type {
  AccountabilityType,
  BelongsTo,
  DocumentType,
  DocumentVisibility,
  IssueProperties,
  IssuePriority,
  IssueSource,
  IssueState,
  WeekProperties,
} from '@ship/shared';

export const documentTypeValues = [
  'wiki',
  'issue',
  'program',
  'project',
  'sprint',
  'person',
  'weekly_plan',
  'weekly_retro',
  'standup',
  'weekly_review',
] as const satisfies readonly DocumentType[];

export const documentTypeSchema = z.enum(documentTypeValues);

export const uuidSchema = z.string().uuid();

export const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const issueTitleSchema = z.string().min(1).max(500);

export const positiveHoursSchema = z.number().positive();

export const documentVisibilityValues = [
  'private',
  'workspace',
] as const satisfies readonly DocumentVisibility[];

export const documentVisibilitySchema = z.enum(documentVisibilityValues);

export const belongsToTypeValues = [
  'program',
  'project',
  'sprint',
  'parent',
] as const;

export const belongsToTypeSchema = z.enum(belongsToTypeValues);

export const belongsToSchema = z.object({
  id: uuidSchema,
  type: belongsToTypeSchema,
}) satisfies z.ZodType<Pick<BelongsTo, 'id' | 'type'>>;

export const issueStateValues = [
  'triage',
  'backlog',
  'todo',
  'in_progress',
  'in_review',
  'done',
  'cancelled',
] as const satisfies readonly IssueState[];

export const issueStateSchema = z.enum(issueStateValues);

export const issuePriorityValues = [
  'urgent',
  'high',
  'medium',
  'low',
  'none',
] as const satisfies readonly IssuePriority[];

export const issuePrioritySchema = z.enum(issuePriorityValues);

export const issueSourceValues = [
  'internal',
  'external',
  'action_items',
] as const satisfies readonly IssueSource[];

export const issueSourceSchema = z.enum(issueSourceValues);

export const accountabilityTypeValues = [
  'standup',
  'weekly_plan',
  'weekly_retro',
  'weekly_review',
  'week_start',
  'week_issues',
  'project_plan',
  'project_retro',
  'changes_requested_plan',
  'changes_requested_retro',
] as const satisfies readonly AccountabilityType[];

export const accountabilityTypeSchema = z.enum(accountabilityTypeValues);

export const issuePropertiesSchema = z.object({
  state: issueStateSchema,
  priority: issuePrioritySchema,
  assignee_id: uuidSchema.nullable().optional(),
  estimate: positiveHoursSchema.nullable().optional(),
  source: issueSourceSchema,
  rejection_reason: z.string().nullable().optional(),
  due_date: isoDateSchema.nullable().optional(),
  is_system_generated: z.boolean().optional(),
  accountability_target_id: uuidSchema.nullable().optional(),
  accountability_type: accountabilityTypeSchema.nullable().optional(),
}).catchall(z.unknown()) satisfies z.ZodType<IssueProperties>;

export const claudeIssueMetadataSchema = z.object({
  updated_by: z.literal('claude'),
  story_id: z.string().optional(),
  prd_name: z.string().optional(),
  session_context: z.string().optional(),
  confidence: z.number().int().min(0).max(100).optional(),
  telemetry: z.object({
    iterations: z.number().int().min(1).optional(),
    feedback_loops: z.object({
      type_check: z.number().int().min(0).optional(),
      test: z.number().int().min(0).optional(),
      build: z.number().int().min(0).optional(),
    }).optional(),
    time_elapsed_seconds: z.number().int().min(0).optional(),
    files_changed: z.array(z.string()).optional(),
  }).optional(),
});

export const createIssueRequestSchema = z.object({
  title: issueTitleSchema,
  state: issueStateSchema.optional().default('backlog'),
  priority: issuePrioritySchema.optional().default('medium'),
  assignee_id: uuidSchema.optional().nullable(),
  belongs_to: z.array(belongsToSchema).optional().default([]),
  source: issueSourceSchema.optional().default('internal'),
  due_date: isoDateSchema.optional().nullable(),
  is_system_generated: z.boolean().optional().default(false),
  accountability_target_id: uuidSchema.optional().nullable(),
  accountability_type: accountabilityTypeSchema.optional().nullable(),
});

export const updateIssueRequestSchema = z.object({
  title: issueTitleSchema.optional(),
  state: issueStateSchema.optional(),
  priority: issuePrioritySchema.optional(),
  assignee_id: uuidSchema.optional().nullable(),
  belongs_to: z.array(belongsToSchema).optional(),
  estimate: positiveHoursSchema.nullable().optional(),
  confirm_orphan_children: z.boolean().optional(),
  claude_metadata: claudeIssueMetadataSchema.optional(),
});

export const canonicalWeekPropertiesSchema = z.object({
  sprint_number: z.number().int().positive(),
  owner_id: uuidSchema,
}) satisfies z.ZodType<Pick<WeekProperties, 'sprint_number' | 'owner_id'>>;

export const idParamSchema = z.object({
  id: uuidSchema,
});
