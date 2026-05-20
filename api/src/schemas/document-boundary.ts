import { z } from 'zod';
import type {
  AccountabilityType,
  BelongsTo,
  DocumentType,
  IssuePriority,
  IssueState,
  WeekProperties,
} from '@ship/shared';

const documentTypeValues = [
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

export const belongsToSchema = z.object({
  id: z.string().uuid(),
  type: z.enum(['program', 'project', 'sprint', 'parent']),
}) satisfies z.ZodType<Pick<BelongsTo, 'id' | 'type'>>;

const issueStateValues = [
  'triage',
  'backlog',
  'todo',
  'in_progress',
  'in_review',
  'done',
  'cancelled',
] as const satisfies readonly IssueState[];

export const issueStateSchema = z.enum(issueStateValues);

const issuePriorityValues = [
  'urgent',
  'high',
  'medium',
  'low',
  'none',
] as const satisfies readonly IssuePriority[];

export const issuePrioritySchema = z.enum(issuePriorityValues);

const accountabilityTypeValues = [
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
