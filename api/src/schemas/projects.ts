import { z } from 'zod';

export const iceScoreSchema = z.number().int().min(1).max(5);

export const createProjectSchema = z.object({
  title: z.string().min(1).max(200).optional().default('Untitled'),
  impact: iceScoreSchema.optional().nullable().default(null),
  confidence: iceScoreSchema.optional().nullable().default(null),
  ease: iceScoreSchema.optional().nullable().default(null),
  owner_id: z.string().uuid().optional().nullable().default(null),
  accountable_id: z.string().uuid().optional().nullable().default(null),
  consulted_ids: z.array(z.string().uuid()).optional().default([]),
  informed_ids: z.array(z.string().uuid()).optional().default([]),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().default('#6366f1'),
  emoji: z.string().max(10).optional().nullable(),
  program_id: z.string().uuid().optional().nullable(),
  plan: z.string().max(2000).optional().nullable(),
  target_date: z.string().datetime().optional().nullable(),
});

export const updateProjectSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  impact: iceScoreSchema.optional().nullable(),
  confidence: iceScoreSchema.optional().nullable(),
  ease: iceScoreSchema.optional().nullable(),
  owner_id: z.string().uuid().optional().nullable(),
  accountable_id: z.string().uuid().optional().nullable(),
  consulted_ids: z.array(z.string().uuid()).optional(),
  informed_ids: z.array(z.string().uuid()).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  emoji: z.string().max(10).optional().nullable(),
  program_id: z.string().uuid().optional().nullable(),
  archived_at: z.string().datetime().optional().nullable(),
  plan: z.string().max(2000).optional().nullable(),
  target_date: z.string().datetime().optional().nullable(),
  has_design_review: z.boolean().optional().nullable(),
  design_review_notes: z.string().max(2000).optional().nullable(),
});

export const projectRetroSchema = z.object({
  plan_validated: z.boolean().nullable().optional(),
  monetary_impact_actual: z.string().max(500).nullable().optional(),
  success_criteria: z.array(z.string().max(500)).nullable().optional(),
  next_steps: z.string().max(2000).nullable().optional(),
  content: z.record(z.unknown()).optional(),
});

export const createProjectSprintSchema = z.object({
  title: z.string().min(1).max(200).optional().default('Untitled'),
  sprint_number: z.number().int().positive().optional(),
  owner_id: z.string().uuid().optional(),
  plan: z.string().max(2000).optional(),
  success_criteria: z.array(z.string().max(500)).max(20).optional(),
  confidence: z.number().int().min(0).max(100).optional(),
});
