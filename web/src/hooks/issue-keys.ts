export interface IssueFilters {
  programId?: string;
  projectId?: string;
  sprintId?: string;
}

export const issueKeys = {
  all: ['issues'] as const,
  lists: () => [...issueKeys.all, 'list'] as const,
  list: (filters?: IssueFilters) => [...issueKeys.lists(), filters ?? {}] as const,
  details: () => [...issueKeys.all, 'detail'] as const,
  detail: (id: string) => [...issueKeys.details(), id] as const,
};

export function normalizeIssueListFilters(filters?: IssueFilters): IssueFilters {
  return filters ?? {};
}
