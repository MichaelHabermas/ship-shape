import { z } from 'zod';
import type {
  AccountabilityType,
  BelongsTo,
  DocumentType,
  DocumentVisibility,
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
  id: z.string().uuid(),
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

export const canonicalWeekPropertiesSchema = z.object({
  sprint_number: z.number().int().positive(),
  owner_id: z.string().uuid(),
}) satisfies z.ZodType<Pick<WeekProperties, 'sprint_number' | 'owner_id'>>;

export const idParamSchema = z.object({
  id: z.string().uuid(),
});
