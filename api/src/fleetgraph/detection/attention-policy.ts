// FleetGraph attention policy maps issue context into one product signal decision.
import type { FleetGraphSignalType } from '@ship/shared';
import type { FleetGraphIssueAttentionContext } from './attention-context.js';

export const STALE_ISSUE_DAYS = 30;
export const AT_RISK_SPRINT_END_DAYS = 3;

export type FleetGraphAttentionPolicyDecision = {
  signalType: FleetGraphSignalType;
  reason: string;
};

function isInactiveSince(date: Date, today: Date, days: number): boolean {
  return date.getTime() <= today.getTime() - days * 24 * 60 * 60 * 1000;
}

function daysUntilCurrentSprintEnds(input: {
  workspaceStartDate: Date;
  today: Date;
  sprintDurationDays?: number;
}): number {
  const sprintDurationDays = input.sprintDurationDays ?? 7;
  const todayUtc = Date.UTC(
    input.today.getUTCFullYear(),
    input.today.getUTCMonth(),
    input.today.getUTCDate()
  );
  const startUtc = Date.UTC(
    input.workspaceStartDate.getUTCFullYear(),
    input.workspaceStartDate.getUTCMonth(),
    input.workspaceStartDate.getUTCDate()
  );
  const daysSinceStart = Math.floor((todayUtc - startUtc) / (24 * 60 * 60 * 1000));
  const dayIndex = ((daysSinceStart % sprintDurationDays) + sprintDurationDays) % sprintDurationDays;
  return sprintDurationDays - dayIndex;
}

export function isWithinCurrentSprintEndWindow(input: {
  workspaceStartDate: Date;
  today: Date;
}): boolean {
  return daysUntilCurrentSprintEnds(input) <= AT_RISK_SPRINT_END_DAYS;
}

function isOpenNonBlockedState(state: string | null): boolean {
  return !['done', 'cancelled', 'blocked'].includes(state ?? 'backlog');
}

export function attentionPolicyForContext(input: {
  context: FleetGraphIssueAttentionContext;
  today: Date;
  currentSprintNumber?: number | null;
  workspaceStartDate?: Date | null;
}): FleetGraphAttentionPolicyDecision | null {
  const { context, today, currentSprintNumber, workspaceStartDate } = input;
  const state = context.issue_state ?? 'backlog';
  if (context.issue_visibility === 'private') return null;

  if (state === 'blocked') {
    return {
      signalType: 'blocked',
      reason: context.blocker_text.trim()
        ? 'Issue state is blocked.'
        : 'Issue is blocked, but no blocker reason is recorded.',
    };
  }

  if (!isOpenNonBlockedState(state)) return null;

  const meaningfulUpdatedAt = context.meaningful_updated_at;
  const isCurrentWeek = currentSprintNumber !== undefined
    && currentSprintNumber !== null
    && context.sprint_number === currentSprintNumber;
  const highPriority = context.issue_priority === 'high' || context.issue_priority === 'urgent';

  if (
    isCurrentWeek
    && highPriority
    && !context.issue_assignee_id
  ) {
    return {
      signalType: 'at_risk',
      reason: 'High-priority current-week work has no owner.',
    };
  }

  if (
    isCurrentWeek
    && highPriority
    && workspaceStartDate
    && isWithinCurrentSprintEndWindow({ workspaceStartDate, today })
  ) {
    return {
      signalType: 'at_risk',
      reason: `High-priority current-week work is within ${AT_RISK_SPRINT_END_DAYS} days of sprint end.`,
    };
  }

  if (
    (state === 'in_progress' || state === 'in_review')
    && isInactiveSince(meaningfulUpdatedAt, today, STALE_ISSUE_DAYS)
  ) {
    return {
      signalType: 'stale',
      reason: `No meaningful update for ${STALE_ISSUE_DAYS}+ days.`,
    };
  }

  return null;
}
