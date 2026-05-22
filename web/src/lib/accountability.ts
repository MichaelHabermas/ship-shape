import { apiPost, readJson } from '@/lib/api';

export type WeeklyDocumentKind = 'plan' | 'retro';

export const ACCOUNTABILITY_TYPE_LABELS: Record<string, string> = {
  standup: 'Post standup',
  weekly_plan: 'Write plan',
  weekly_retro: 'Write retro',
  weekly_review: 'Complete review',
  week_start: 'Start week',
  week_issues: 'Add issues',
  project_plan: 'Write plan',
  project_retro: 'Complete retro',
  changes_requested_plan: 'Revise plan',
  changes_requested_retro: 'Revise retro',
};

const PLAN_ACCOUNTABILITY_TYPES = new Set([
  'weekly_plan',
  'changes_requested_plan',
]);

const RETRO_ACCOUNTABILITY_TYPES = new Set([
  'weekly_retro',
  'changes_requested_retro',
]);

export function getWeeklyDocumentKindForAccountabilityType(
  accountabilityType: string | null | undefined
): WeeklyDocumentKind | null {
  if (!accountabilityType) return null;
  if (PLAN_ACCOUNTABILITY_TYPES.has(accountabilityType)) return 'plan';
  if (RETRO_ACCOUNTABILITY_TYPES.has(accountabilityType)) return 'retro';
  return null;
}

export function isWeeklyDocumentAccountabilityType(
  accountabilityType: string | null | undefined
): boolean {
  return getWeeklyDocumentKindForAccountabilityType(accountabilityType) !== null;
}

interface CreateOrGetWeeklyDocumentParams {
  kind: WeeklyDocumentKind;
  personId: string;
  projectId?: string;
  weekNumber: number;
}

export async function createOrGetWeeklyDocumentId({
  kind,
  personId,
  projectId,
  weekNumber,
}: CreateOrGetWeeklyDocumentParams): Promise<string | null> {
  const endpoint = kind === 'retro' ? '/api/weekly-retros' : '/api/weekly-plans';
  const body: Record<string, unknown> = {
    person_id: personId,
    week_number: weekNumber,
  };
  if (projectId) {
    body.project_id = projectId;
  }
  const response = await apiPost(endpoint, body);

  if (!response.ok) return null;

  const data = await readJson<{ id?: string }>(response).catch(() => null);
  if (!data || typeof data.id !== 'string') return null;
  return data.id;
}

export function formatActionItemDueDate(
  dueDate: string | null,
  daysOverdue: number
): { text: string; isOverdue: boolean } {
  if (!dueDate) {
    return { text: 'No due date', isOverdue: false };
  }

  if (daysOverdue > 0) {
    return { text: `${daysOverdue} day${daysOverdue === 1 ? '' : 's'} overdue`, isOverdue: true };
  }

  if (daysOverdue === 0) {
    return { text: 'Due today', isOverdue: true };
  }

  const dueDateObj = new Date(`${dueDate}T00:00:00`);
  return {
    text: `Due ${dueDateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`,
    isOverdue: false,
  };
}
