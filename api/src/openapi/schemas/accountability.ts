/**
 * Accountability schemas - Inference-based action items
 *
 * These endpoints compute what needs attention dynamically from current state.
 * No issues are created; items are inferred on each request.
 */

import { z, registry } from '../registry.js';
import { UuidSchema, DateSchema } from './common.js';

// ============== Accountability Types ==============

export const InferredAccountabilityTypeSchema = z.enum([
  'standup',
  'weekly_plan',
  'weekly_review',
  'weekly_retro',
  'week_start',
  'week_issues',
  'project_plan',
  'project_retro',
  'changes_requested_plan',
  'changes_requested_retro',
]).openapi({
  description: 'Type of accountability task',
});

registry.register('InferredAccountabilityType', InferredAccountabilityTypeSchema);

// ============== Inferred Action Item ==============

export const InferredActionItemSchema = z.object({
  id: z.string().openapi({
    description: 'Synthetic ID (e.g., "standup-{sprintId}")',
  }),
  title: z.string().openapi({
    description: 'Human-readable message describing the action needed',
  }),
  state: z.literal('todo'),
  priority: z.literal('high'),
  ticket_number: z.literal(0),
  display_id: z.literal(''),
  is_system_generated: z.literal(true),
  accountability_type: InferredAccountabilityTypeSchema,
  accountability_target_id: UuidSchema.openapi({
    description: 'Document ID to navigate to',
  }),
  target_title: z.string().openapi({
    description: 'Title of the target document',
  }),
  due_date: DateSchema.nullable(),
  days_overdue: z.number().int().openapi({
    description: 'Positive if past due, 0 if due today, negative if upcoming',
  }),
}).openapi('InferredActionItem');

registry.register('InferredActionItem', InferredActionItemSchema);

// ============== Action Items Response ==============

export const AccountabilityActionItemsResponseSchema = z.object({
  items: z.array(InferredActionItemSchema),
  total: z.number().int(),
  has_overdue: z.boolean().openapi({
    description: 'True if any item has days_overdue > 0',
  }),
  has_due_today: z.boolean().openapi({
    description: 'True if any item has days_overdue === 0',
  }),
}).openapi('AccountabilityActionItemsResponse');

registry.register('AccountabilityActionItemsResponse', AccountabilityActionItemsResponseSchema);

// ============== Register Accountability Endpoints ==============

registry.registerPath({
  method: 'get',
  path: '/accountability/action-items',
  tags: ['Accountability'],
  summary: 'Get inferred action items',
  description: 'Returns action items computed dynamically from project/sprint state. No issues are created; items are inferred on each request.',
  responses: {
    200: {
      description: 'Inferred action items sorted by urgency',
      content: {
        'application/json': {
          schema: AccountabilityActionItemsResponseSchema,
        },
      },
    },
  },
});
