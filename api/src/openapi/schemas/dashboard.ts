/**
 * Dashboard schemas - My work and overview data
 */

import { z, registry } from '../registry.js';
import { inferredProjectStatusSchema } from '../../schemas/document-boundary.js';
import { UuidSchema, DateSchema, DateTimeSchema } from './common.js';

// ============== Work Item ==============

export const UrgencySchema = z.enum(['overdue', 'this_sprint', 'later']).openapi({
  description: 'Urgency level for work items',
});

export const WorkItemSchema = z.object({
  id: UuidSchema,
  title: z.string(),
  type: z.enum(['issue', 'project', 'sprint']),
  urgency: UrgencySchema,
  // Issue-specific
  state: z.string().optional(),
  priority: z.string().optional(),
  ticket_number: z.number().int().optional(),
  sprint_id: UuidSchema.nullable().optional(),
  sprint_name: z.string().nullable().optional(),
  // Project-specific
  ice_score: z.number().nullable().optional(),
  inferred_status: inferredProjectStatusSchema.optional(),
  // Sprint-specific
  sprint_number: z.number().int().optional(),
  days_remaining: z.number().int().optional(),
  // Common
  program_name: z.string().nullable().optional(),
}).openapi('WorkItem');

registry.register('WorkItem', WorkItemSchema);

// ============== My Work Response ==============

export const MyWorkResponseSchema = z.object({
  items: z.array(WorkItemSchema),
  currentSprintNumber: z.number().int(),
  daysRemaining: z.number().int().openapi({
    description: 'Days remaining in current sprint',
  }),
}).openapi('MyWorkResponse');

registry.register('MyWorkResponse', MyWorkResponseSchema);

// ============== Register Dashboard Endpoints ==============

registry.registerPath({
  method: 'get',
  path: '/dashboard/my-work',
  tags: ['Dashboard'],
  summary: 'Get my work items',
  description: 'Returns work items for the current user organized by urgency: issues assigned, projects owned, and active sprints.',
  responses: {
    200: {
      description: 'Work items organized by urgency',
      content: {
        'application/json': {
          schema: MyWorkResponseSchema,
        },
      },
    },
  },
});

// ============== My Focus ==============

export const PlanItemSchema = z.object({
  text: z.string(),
  checked: z.boolean(),
}).openapi('PlanItem');

registry.register('PlanItem', PlanItemSchema);

export const FocusPlanSchema = z.object({
  id: UuidSchema.nullable(),
  week_number: z.number().int(),
  items: z.array(PlanItemSchema),
}).openapi('FocusPlan');

registry.register('FocusPlan', FocusPlanSchema);

export const RecentActivityItemSchema = z.object({
  id: UuidSchema,
  title: z.string(),
  ticket_number: z.number().int(),
  state: z.string(),
  updated_at: z.string(),
}).openapi('RecentActivityItem');

registry.register('RecentActivityItem', RecentActivityItemSchema);

export const FocusProjectSchema = z.object({
  id: UuidSchema,
  title: z.string(),
  program_name: z.string().nullable(),
  plan: FocusPlanSchema,
  previous_plan: FocusPlanSchema,
  recent_activity: z.array(RecentActivityItemSchema),
}).openapi('FocusProject');

registry.register('FocusProject', FocusProjectSchema);

export const MyFocusResponseSchema = z.object({
  person_id: UuidSchema,
  current_week_number: z.number().int(),
  week_start: z.string().openapi({ description: 'ISO date string (YYYY-MM-DD)' }),
  week_end: z.string().openapi({ description: 'ISO date string (YYYY-MM-DD)' }),
  projects: z.array(FocusProjectSchema),
}).openapi('MyFocusResponse');

registry.register('MyFocusResponse', MyFocusResponseSchema);

registry.registerPath({
  method: 'get',
  path: '/dashboard/my-focus',
  tags: ['Dashboard'],
  summary: 'Get my project focus for the current week',
  description: 'Returns the current user\'s project context: allocated projects, current and previous week plans with parsed items, and recent issue activity.',
  responses: {
    200: {
      description: 'Project focus data for the current user',
      content: {
        'application/json': {
          schema: MyFocusResponseSchema,
        },
      },
    },
    404: {
      description: 'Person not found for current user',
    },
  },
});

// ============== My Week ==============

export const WeekMetadataSchema = z.object({
  week_number: z.number().int(),
  current_week_number: z.number().int(),
  start_date: DateSchema,
  end_date: DateSchema,
  is_current: z.boolean(),
}).openapi('WeekMetadata');

registry.register('WeekMetadata', WeekMetadataSchema);

export const MyWeekPlanSchema = z.object({
  id: UuidSchema,
  title: z.string(),
  submitted_at: DateTimeSchema.nullable(),
  items: z.array(PlanItemSchema),
}).openapi('MyWeekPlan');

registry.register('MyWeekPlan', MyWeekPlanSchema);

export const MyWeekRetroSchema = z.object({
  id: UuidSchema,
  title: z.string(),
  submitted_at: DateTimeSchema.nullable(),
  items: z.array(PlanItemSchema),
}).openapi('MyWeekRetro');

registry.register('MyWeekRetro', MyWeekRetroSchema);

export const PreviousRetroSchema = z.object({
  id: UuidSchema.nullable(),
  title: z.string().nullable(),
  submitted_at: DateTimeSchema.nullable(),
  week_number: z.number().int(),
}).openapi('PreviousRetro');

registry.register('PreviousRetro', PreviousRetroSchema);

export const StandupSlotSchema = z.object({
  date: DateSchema,
  day: z.string().openapi({ description: 'Day of week name (e.g., "Monday")' }),
  standup: z.object({
    id: UuidSchema,
    title: z.string(),
    date: DateSchema,
    created_at: DateTimeSchema,
  }).nullable(),
}).openapi('StandupSlot');

registry.register('StandupSlot', StandupSlotSchema);

export const WeekProjectSchema = z.object({
  id: UuidSchema,
  title: z.string(),
  program_name: z.string().nullable(),
}).openapi('WeekProject');

registry.register('WeekProject', WeekProjectSchema);

export const MyWeekResponseSchema = z.object({
  person_id: UuidSchema,
  person_name: z.string(),
  week: WeekMetadataSchema,
  plan: MyWeekPlanSchema.nullable(),
  retro: MyWeekRetroSchema.nullable(),
  previous_retro: PreviousRetroSchema.nullable(),
  standups: z.array(StandupSlotSchema).openapi({ description: '7-slot array, one per day of the week' }),
  projects: z.array(WeekProjectSchema),
}).openapi('MyWeekResponse');

registry.register('MyWeekResponse', MyWeekResponseSchema);

registry.registerPath({
  method: 'get',
  path: '/dashboard/my-week',
  tags: ['Dashboard'],
  summary: 'Get my week dashboard data',
  description: 'Returns aggregated data for the current user\'s week: plan, retro, standups (7 slots), and project allocations. Supports ?week_number=N for navigation.',
  request: {
    query: z.object({
      week_number: z.coerce.number().int().positive().optional().openapi({
        description: 'Target week number (defaults to current week)',
      }),
    }),
  },
  responses: {
    200: {
      description: 'Week dashboard data',
      content: {
        'application/json': {
          schema: MyWeekResponseSchema,
        },
      },
    },
    404: {
      description: 'Person or workspace not found',
    },
  },
});
