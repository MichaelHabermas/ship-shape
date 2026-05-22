import type { QueryClient } from '@tanstack/react-query';
import type { BelongsToType } from '@ship/shared';
import type { IssueListItem } from '@/api/schemas';
import { issueKeys, normalizeIssueListFilters, type IssueFilters } from '@/hooks/issue-keys';

export type IssueListCacheSnapshot = Array<
  [ReturnType<typeof issueKeys.list>, IssueListItem[] | undefined]
>;

function getAssociationId(issue: IssueListItem, type: BelongsToType): string | null {
  return issue.belongs_to?.find((association) => association.type === type)?.id ?? null;
}

export function issueMatchesFilters(issue: IssueListItem, filters: IssueFilters): boolean {
  if (
    (filters.programId && getAssociationId(issue, 'program') !== filters.programId) || 
    (filters.projectId && getAssociationId(issue, 'project') !== filters.projectId) ||
    (filters.sprintId && getAssociationId(issue, 'sprint') !== filters.sprintId)
  ) {
    return false;
  }
  return true;
}

export async function cancelIssueListQueries(queryClient: QueryClient): Promise<void> {
  await queryClient.cancelQueries({ queryKey: issueKeys.lists() });
}

export function snapshotIssueListQueries(queryClient: QueryClient): IssueListCacheSnapshot {
  return queryClient.getQueriesData<IssueListItem[]>({ queryKey: issueKeys.lists() }) as IssueListCacheSnapshot;
}

export function patchIssueListQueries(
  queryClient: QueryClient,
  updater: (old: IssueListItem[] | undefined, filters: IssueFilters) => IssueListItem[] | undefined,
): void {
  const entries = snapshotIssueListQueries(queryClient);
  for (const [key, data] of entries) {
    const filters = normalizeIssueListFilters(key[2]);
    queryClient.setQueryData(key, updater(data, filters));
  }
}

export function restoreIssueListQueries(
  queryClient: QueryClient,
  snapshot: IssueListCacheSnapshot,
): void {
  for (const [key, data] of snapshot) {
    queryClient.setQueryData(key, data);
  }
}

export function prependIssueToMatchingLists(
  queryClient: QueryClient,
  issue: IssueListItem,
): void {
  patchIssueListQueries(queryClient, (old, filters) => {
    if (!issueMatchesFilters(issue, filters)) {
      return old;
    }
    return [issue, ...(old || [])];
  });
}

export function replaceIssueInMatchingLists(
  queryClient: QueryClient,
  issueId: string,
  mapper: (issue: IssueListItem) => IssueListItem,
): void {
  patchIssueListQueries(queryClient, (old, filters) => {
    if (!old) {
      return old;
    }

    const existing = old.find((issue) => issue.id === issueId);
    if (!existing) {
      return old;
    }

    const nextIssue = mapper(existing);
    if (!issueMatchesFilters(nextIssue, filters)) {
      return old.filter((issue) => issue.id !== issueId);
    }

    return old.map((issue) => (issue.id === issueId ? nextIssue : issue));
  });
}

export function replaceIssueWithServerData(
  queryClient: QueryClient,
  issueId: string,
  nextIssue: IssueListItem,
): void {
  patchIssueListQueries(queryClient, (old, filters) => {
    if (!old) {
      return issueMatchesFilters(nextIssue, filters) ? [nextIssue] : old;
    }

    const hadIssue = old.some((issue) => issue.id === issueId);
    if (!hadIssue) {
      return issueMatchesFilters(nextIssue, filters) ? [nextIssue, ...old] : old;
    }

    if (!issueMatchesFilters(nextIssue, filters)) {
      return old.filter((issue) => issue.id !== issueId);
    }

    return old.map((issue) => (issue.id === issueId ? nextIssue : issue));
  });
}

export function patchIssuesInMatchingLists(
  queryClient: QueryClient,
  updater: (issues: IssueListItem[], filters: IssueFilters) => IssueListItem[] | undefined,
): void {
  patchIssueListQueries(queryClient, (old, filters) => updater(old || [], filters));
}

export { normalizeIssueListFilters };
