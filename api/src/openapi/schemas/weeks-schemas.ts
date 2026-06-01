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

export const ActiveWeekItemSchema = WeekResponseSchema.extend({
  days_remaining: z.number().int().openapi({
    description: 'Days remaining in the current sprint window',
  }),
  owner_reports_to: z.string().nullable().optional(),
  review_rating: z.number().nullable().optional(),
}).openapi('ActiveWeekItem');

registry.register('ActiveWeekItem', ActiveWeekItemSchema);

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

export const SprintReviewResponseSchema = z.object({
  id: UuidSchema.nullable(),
  sprint_id: UuidSchema,
  title: z.string(),
  content: z.record(z.unknown()).nullable(),
  plan_validated: z.boolean().nullable(),
  owner_id: UuidSchema.nullable(),
  owner_name: z.string().nullable().optional(),
  owner_email: z.string().nullable().optional(),
  created_at: DateTimeSchema.nullable(),
  updated_at: DateTimeSchema.nullable(),
  is_draft: z.boolean(),
}).openapi('SprintReviewResponse');

registry.register('SprintReviewResponse', SprintReviewResponseSchema);

export const WeekPlanApprovalResponseSchema = z.object({
  success: z.literal(true),
  approval: ApprovalTrackingSchema,
}).openapi('WeekPlanApprovalResponse');

registry.register('WeekPlanApprovalResponse', WeekPlanApprovalResponseSchema);

// ============== Active Weeks Response ==============

export const ActiveWeeksResponseSchema = z.object({
  weeks: z.array(ActiveWeekItemSchema),
  current_sprint_number: z.number().int(),
  days_remaining: z.number().int().openapi({
    description: 'Days remaining in current sprint',
  }),
  sprint_start_date: DateSchema,
  sprint_end_date: DateSchema,
}).openapi('ActiveWeeksResponse');

registry.register('ActiveWeeksResponse', ActiveWeeksResponseSchema);

// ============== Register Week Endpoints ==============
