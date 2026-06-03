import type { FleetGraphSignalType } from '@ship/shared';

export const BLOCKED_IMPORTANT_ISSUE_DEDUPE_PREFIX = 'blocked-important-issue';
export const STALE_ISSUE_DEDUPE_PREFIX = 'stale-issue';
export const AT_RISK_ISSUE_DEDUPE_PREFIX = 'at-risk-issue';

export function blockedImportantIssueDedupeKey(input: {
  workspaceId: string;
  issueId: string;
  sprintId: string;
}): string {
  return `${BLOCKED_IMPORTANT_ISSUE_DEDUPE_PREFIX}:${input.workspaceId}:${input.issueId}:${input.sprintId}`;
}

export function fleetGraphAttentionDedupeKey(input: {
  signalType: FleetGraphSignalType;
  workspaceId: string;
  issueId: string;
  sprintId: string;
}): string {
  return `${dedupePrefixForSignalType(input.signalType)}:${input.workspaceId}:${input.issueId}:${input.sprintId}`;
}

export function signalTypeFromDedupeKey(dedupeKey: string): FleetGraphSignalType {
  if (dedupeKey.startsWith(`${STALE_ISSUE_DEDUPE_PREFIX}:`)) return 'stale';
  if (dedupeKey.startsWith(`${AT_RISK_ISSUE_DEDUPE_PREFIX}:`)) return 'at_risk';
  return 'blocked';
}

export function fleetGraphSignalType(value: unknown): FleetGraphSignalType {
  return value === 'stale' || value === 'at_risk' || value === 'blocked' ? value : 'blocked';
}

export function signalLabelForType(signalType: FleetGraphSignalType): string {
  switch (signalType) {
    case 'blocked':
      return 'Blocked';
    case 'stale':
      return 'Stale';
    case 'at_risk':
      return 'At risk';
  }
}

export function dedupePrefixForSignalType(signalType: FleetGraphSignalType): string {
  switch (signalType) {
    case 'blocked':
      return BLOCKED_IMPORTANT_ISSUE_DEDUPE_PREFIX;
    case 'stale':
      return STALE_ISSUE_DEDUPE_PREFIX;
    case 'at_risk':
      return AT_RISK_ISSUE_DEDUPE_PREFIX;
  }
}

export function sqlBlockedImportantIssueDedupeKey(
  workspaceColumn: string,
  issueColumn: string,
  sprintColumn: string,
): string {
  return `CONCAT('${BLOCKED_IMPORTANT_ISSUE_DEDUPE_PREFIX}', ':', ${workspaceColumn}, ':', ${issueColumn}, ':', ${sprintColumn})`;
}
