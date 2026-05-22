import { z } from 'zod';
import {
  ACCOUNTABILITY_TYPE_VALUES,
  BELONGS_TO_TYPE_VALUES,
  DOCUMENT_TYPE_VALUES,
  DOCUMENT_VISIBILITY_VALUES,
  INFERRED_PROJECT_STATUS_VALUES,
  ISSUE_PRIORITY_VALUES,
  ISSUE_SOURCE_VALUES,
  ISSUE_STATE_VALUES,
  type BelongsTo,
  type IssueProperties,
  type WeekProperties,
} from '@ship/shared';

export const documentTypeValues = DOCUMENT_TYPE_VALUES;
export const documentTypeSchema = z.enum(documentTypeValues);

export const uuidSchema = z.string().uuid();

export const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const issueTitleSchema = z.string().min(1).max(500);

export const positiveHoursSchema = z.number().positive();

export const documentVisibilityValues = DOCUMENT_VISIBILITY_VALUES;
export const documentVisibilitySchema = z.enum(documentVisibilityValues);

export const belongsToTypeValues = BELONGS_TO_TYPE_VALUES;
export const belongsToTypeSchema = z.enum(belongsToTypeValues);

export const belongsToSchema = z.object({
  id: uuidSchema,
  type: belongsToTypeSchema,
}) satisfies z.ZodType<Pick<BelongsTo, 'id' | 'type'>>;

export const issueStateValues = ISSUE_STATE_VALUES;
export const issueStateSchema = z.enum(issueStateValues);

export const issuePriorityValues = ISSUE_PRIORITY_VALUES;
export const issuePrioritySchema = z.enum(issuePriorityValues);

export const issueSourceValues = ISSUE_SOURCE_VALUES;
export const issueSourceSchema = z.enum(issueSourceValues);

export const accountabilityTypeValues = ACCOUNTABILITY_TYPE_VALUES;
export const accountabilityTypeSchema = z.enum(accountabilityTypeValues);

export const inferredProjectStatusValues = INFERRED_PROJECT_STATUS_VALUES;
export const inferredProjectStatusSchema = z.enum(inferredProjectStatusValues);

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
