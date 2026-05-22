import { describe, it, expect, vi, beforeEach } from 'vitest';
import { apiPost } from '@/lib/api';
import {
  ACCOUNTABILITY_TYPE_LABELS,
  createOrGetWeeklyDocumentId,
  formatActionItemDueDate,
  getWeeklyDocumentKindForAccountabilityType,
  isWeeklyDocumentAccountabilityType,
} from './accountability';

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    apiPost: vi.fn(),
  };
});

const mockedApiPost = vi.mocked(apiPost);

describe('accountability helpers', () => {
  beforeEach(() => {
    mockedApiPost.mockReset();
  });

  it('maps weekly accountability types to weekly document kinds', () => {
    expect(getWeeklyDocumentKindForAccountabilityType('weekly_plan')).toBe('plan');
    expect(getWeeklyDocumentKindForAccountabilityType('changes_requested_plan')).toBe('plan');
    expect(getWeeklyDocumentKindForAccountabilityType('weekly_retro')).toBe('retro');
    expect(getWeeklyDocumentKindForAccountabilityType('changes_requested_retro')).toBe('retro');
    expect(getWeeklyDocumentKindForAccountabilityType('standup')).toBeNull();
    expect(getWeeklyDocumentKindForAccountabilityType(null)).toBeNull();
  });

  it('contains shared labels for all accountability item variants', () => {
    expect(ACCOUNTABILITY_TYPE_LABELS.weekly_plan).toBe('Write plan');
    expect(ACCOUNTABILITY_TYPE_LABELS.weekly_retro).toBe('Write retro');
    expect(ACCOUNTABILITY_TYPE_LABELS.changes_requested_plan).toBe('Revise plan');
    expect(ACCOUNTABILITY_TYPE_LABELS.changes_requested_retro).toBe('Revise retro');
  });

  it('detects whether an accountability type creates a weekly document', () => {
    expect(isWeeklyDocumentAccountabilityType('weekly_plan')).toBe(true);
    expect(isWeeklyDocumentAccountabilityType('weekly_retro')).toBe(true);
    expect(isWeeklyDocumentAccountabilityType('changes_requested_plan')).toBe(true);
    expect(isWeeklyDocumentAccountabilityType('changes_requested_retro')).toBe(true);
    expect(isWeeklyDocumentAccountabilityType('week_start')).toBe(false);
    expect(isWeeklyDocumentAccountabilityType(undefined)).toBe(false);
  });

  it('creates plan documents using the weekly plans endpoint', async () => {
    mockedApiPost.mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'plan-123' }),
    } as Response);

    const result = await createOrGetWeeklyDocumentId({
      kind: 'plan',
      personId: 'person-1',
      projectId: 'project-1',
      weekNumber: 15,
    });

    expect(result).toBe('plan-123');
    expect(mockedApiPost).toHaveBeenCalledWith('/api/weekly-plans', {
      person_id: 'person-1',
      project_id: 'project-1',
      week_number: 15,
    });
  });

  it('creates retro documents using the weekly retros endpoint', async () => {
    mockedApiPost.mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'retro-123' }),
    } as Response);

    const result = await createOrGetWeeklyDocumentId({
      kind: 'retro',
      personId: 'person-1',
      projectId: 'project-1',
      weekNumber: 15,
    });

    expect(result).toBe('retro-123');
    expect(mockedApiPost).toHaveBeenCalledWith('/api/weekly-retros', {
      person_id: 'person-1',
      project_id: 'project-1',
      week_number: 15,
    });
  });

  it('returns null when weekly document creation fails', async () => {
    mockedApiPost.mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'failed' }),
    } as Response);

    const result = await createOrGetWeeklyDocumentId({
      kind: 'plan',
      personId: 'person-1',
      projectId: 'project-1',
      weekNumber: 15,
    });

    expect(result).toBeNull();
  });

  it('formats due date labels for overdue, due today, and upcoming items', () => {
    expect(formatActionItemDueDate('2026-02-10', 3)).toEqual({
      text: '3 days overdue',
      isOverdue: true,
    });

    expect(formatActionItemDueDate('2026-02-17', 0)).toEqual({
      text: 'Due today',
      isOverdue: true,
    });

    expect(formatActionItemDueDate('2026-02-20', -1)).toEqual({
      text: 'Due Feb 20',
      isOverdue: false,
    });
  });
});
