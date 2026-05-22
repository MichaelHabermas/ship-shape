import { computeICEScore } from '@ship/shared';
import type { Program, Project, ProgramSprintListItem } from '@/api/schemas';

export function createOptimisticProgram(input: { title?: string }): Program {
  const now = new Date().toISOString();
  return {
    id: `temp-${crypto.randomUUID()}`,
    name: input.title ?? 'Untitled',
    color: '#6B7280',
    emoji: null,
    archived_at: null,
    created_at: now,
    updated_at: now,
    issue_count: 0,
    sprint_count: 0,
    owner: null,
    owner_id: null,
    accountable_id: null,
    consulted_ids: [],
    informed_ids: [],
  };
}

export function createOptimisticProject(input: {
  title?: string;
  owner_id?: string | null;
  accountable_id?: string | null;
  consulted_ids?: string[];
  informed_ids?: string[];
  impact?: number | null;
  confidence?: number | null;
  ease?: number | null;
  color?: string;
  program_id?: string;
  plan?: string;
  target_date?: string;
}): Project {
  const now = new Date().toISOString();
  const impact = input.impact ?? null;
  const confidence = input.confidence ?? null;
  const ease = input.ease ?? null;

  return {
    id: `temp-${crypto.randomUUID()}`,
    title: input.title ?? 'Untitled',
    impact,
    confidence,
    ease,
    ice_score: computeICEScore(impact, confidence, ease),
    color: input.color ?? '#6366f1',
    emoji: null,
    program_id: input.program_id ?? null,
    owner: null,
    owner_id: input.owner_id ?? null,
    accountable_id: input.accountable_id ?? null,
    consulted_ids: input.consulted_ids ?? [],
    informed_ids: input.informed_ids ?? [],
    plan: input.plan ?? null,
    plan_approval: null,
    retro_approval: null,
    has_retro: false,
    has_design_review: null,
    design_review_notes: null,
    target_date: input.target_date ?? null,
    sprint_count: 0,
    issue_count: 0,
    inferred_status: 'backlog',
    archived_at: null,
    created_at: now,
    updated_at: now,
    is_complete: null,
    missing_fields: [],
    converted_from_id: null,
  };
}

export function createOptimisticProgramSprint(input: {
  title: string;
  sprint_number: number;
}): ProgramSprintListItem {
  return {
    id: `temp-${crypto.randomUUID()}`,
    name: input.title,
    sprint_number: input.sprint_number,
    status: 'planning',
    owner: null,
    issue_count: 0,
    completed_count: 0,
    started_count: 0,
    total_estimate_hours: 0,
    has_plan: false,
    has_retro: false,
    plan_created_at: null,
    retro_created_at: null,
    plan: null,
  };
}
