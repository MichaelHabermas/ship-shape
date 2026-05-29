import { z } from 'zod';

export const createProgramSchema = z.object({
  title: z.string().min(1).max(200).optional().default('Untitled'),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().default('#6366f1'),
  emoji: z.string().max(10).optional().nullable(),
  owner_id: z.string().uuid().optional().nullable().default(null),
  accountable_id: z.string().uuid().optional().nullable().default(null),
  consulted_ids: z.array(z.string().uuid()).optional().default([]),
  informed_ids: z.array(z.string().uuid()).optional().default([]),
});

export const updateProgramSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  emoji: z.string().max(10).optional().nullable(),
  owner_id: z.string().uuid().optional().nullable(),
  accountable_id: z.string().uuid().optional().nullable(),
  consulted_ids: z.array(z.string().uuid()).optional(),
  informed_ids: z.array(z.string().uuid()).optional(),
  archived_at: z.string().datetime().optional().nullable(),
});

export const mergeProgramSchema = z.object({
  target_id: z.string().uuid(),
  confirm_name: z.string().min(1),
});
