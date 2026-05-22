import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient, assertApiData } from '@/api/client';
import type { Issue, IssueListItem } from '@/api/schemas';
import type {
  CascadeWarning,
  IncompleteChild,
  BelongsTo,
  BelongsToType,
  IssueState,
} from '@ship/shared';

import {
  cancelIssueListQueries,
  issueMatchesFilters,
  patchIssueListQueries,
  patchIssuesInMatchingLists,
  prependIssueToMatchingLists,
  replaceIssueInMatchingLists,
  replaceIssueWithServerData,
  restoreIssueListQueries,
  snapshotIssueListQueries,
} from '@/hooks/issue-list-cache';
import { issueKeys, type IssueFilters } from '@/hooks/issue-keys';

export type { Issue, IssueListItem, IssueFilters };
export { issueKeys };

// Custom error type for cascade warning (409 response)
export class CascadeWarningError extends Error {
  status = 409;
  warning: CascadeWarning;

  constructor(warning: CascadeWarning) {
    super(warning.message);
    this.name = 'CascadeWarningError';
    this.warning = warning;
  }
}

// Type guard for CascadeWarningError
export function isCascadeWarningError(error: unknown): error is CascadeWarningError {
  return error instanceof CascadeWarningError;
}

// Re-export for convenience
export type { CascadeWarning, IncompleteChild, BelongsTo, BelongsToType };

type IssueWithAssociations = {
  belongs_to?: BelongsTo[];
};

function issueToListItem(issue: Issue): IssueListItem {
  const { content: _content, ...listItem } = issue;
  return listItem as IssueListItem;
}
// Helper to extract association ID by type
export function getAssociationId(issue: IssueWithAssociations, type: BelongsToType): string | null {
  const association = issue.belongs_to?.find(a => a.type === type);
  return association?.id ?? null;
}

// Helper to get program ID from belongs_to
export function getProgramId(issue: IssueWithAssociations): string | null {
  return getAssociationId(issue, 'program');
}

// Helper to get sprint ID from belongs_to
export function getSprintId(issue: IssueWithAssociations): string | null {
  return getAssociationId(issue, 'sprint');
}

// Helper to get project ID from belongs_to
export function getProjectId(issue: IssueWithAssociations): string | null {
  return getAssociationId(issue, 'project');
}

// Helper to get association title by type (e.g., program name)
export function getAssociationTitle(issue: IssueWithAssociations, type: BelongsToType): string | null {
  const association = issue.belongs_to?.find(a => a.type === type);
  return association?.title ?? null;
}

// Helper to get program title from belongs_to
export function getProgramTitle(issue: IssueWithAssociations): string | null {
  return getAssociationTitle(issue, 'program');
}

// Helper to get project title from belongs_to
export function getProjectTitle(issue: IssueWithAssociations): string | null {
  return getAssociationTitle(issue, 'project');
}

// Helper to get sprint title from belongs_to
export function getSprintTitle(issue: IssueWithAssociations): string | null {
  return getAssociationTitle(issue, 'sprint');
}

// Fetch issues with optional filters
async function fetchIssues(filters?: IssueFilters): Promise<IssueListItem[]> {
  const result = await apiClient.GET('/issues', {
    params: {
      query: {
        ...(filters?.programId ? { program_id: filters.programId } : {}),
        ...(filters?.projectId ? { project_id: filters.projectId } : {}),
        ...(filters?.sprintId ? { sprint_id: filters.sprintId } : {}),
      },
    },
  });
  return assertApiData(result, 'Failed to fetch issues');
}

// Create issue
interface CreateIssueData {
  title?: string;
  belongs_to?: BelongsTo[];
}

async function createIssueApi(data: CreateIssueData): Promise<Issue> {
  const result = await apiClient.POST('/issues', {
    body: {
      title: data.title ?? 'Untitled',
      state: 'backlog',
      priority: 'medium',
      belongs_to: data.belongs_to ?? [],
      source: 'internal',
      is_system_generated: false,
    },
  });
  return assertApiData(result, 'Failed to create issue');
}

async function updateIssueApi(id: string, updates: Partial<Issue>): Promise<Issue> {
  const result = await apiClient.PATCH('/issues/{id}', {
    params: { path: { id } },
    body: updates,
  });

  if (result.response.status === 409) {
    const body = (result.error ?? await result.response.clone().json().catch(() => null)) as
      | ({ error?: string } & CascadeWarning)
      | null;
    if (body?.error === 'incomplete_children') {
      throw new CascadeWarningError(body);
    }
  }

  return assertApiData(result, 'Failed to update issue');
}

// Hook to get issues with optional filters
export interface UseIssuesQueryOptions {
  /** Whether the query should execute. Default: true */
  enabled?: boolean;
}

export function useIssuesQuery(filters?: IssueFilters, options?: UseIssuesQueryOptions) {
  const { enabled = true } = options ?? {};
  return useQuery({
    queryKey: issueKeys.list(filters),
    queryFn: () => fetchIssues(filters),
    staleTime: 1000 * 60 * 5, // 5 minutes
    enabled,
  });
}

// Hook to create issue with optimistic update
export function useCreateIssue() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data?: CreateIssueData) => createIssueApi(data || {}),
    onMutate: async (newIssue) => {
      await cancelIssueListQueries(queryClient);
      const snapshot = snapshotIssueListQueries(queryClient);

      const belongs_to: BelongsTo[] = newIssue?.belongs_to || [];

      const optimisticIssue: IssueListItem = {
        id: `temp-${crypto.randomUUID()}`,
        title: newIssue?.title ?? 'Untitled',
        state: 'backlog',
        priority: 'medium',
        ticket_number: -1,
        display_id: 'PENDING',
        belongs_to,
        source: 'internal',
        rejection_reason: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      prependIssueToMatchingLists(queryClient, optimisticIssue);

      return { snapshot, optimisticId: optimisticIssue.id };
    },
    onError: (_err, _newIssue, context) => {
      if (context?.snapshot) {
        restoreIssueListQueries(queryClient, context.snapshot);
      }
    },
    onSuccess: (data, _variables, context) => {
      if (context?.optimisticId) {
        replaceIssueWithServerData(queryClient, context.optimisticId, issueToListItem(data));
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: issueKeys.lists() });
    },
  });
}

// Hook to update issue with optimistic update
export function useUpdateIssue() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, updates }: { id: string; updates: Partial<Issue> }) =>
      updateIssueApi(id, updates),
    onMutate: async ({ id, updates }) => {
      await cancelIssueListQueries(queryClient);
      const snapshot = snapshotIssueListQueries(queryClient);

      replaceIssueInMatchingLists(queryClient, id, (issue) => {
        const newBelongsTo = updates.belongs_to ?? issue.belongs_to ?? [];
        return { ...issue, ...updates, belongs_to: newBelongsTo } as IssueListItem;
      });

      return { snapshot };
    },
    onError: (_err, _variables, context) => {
      if (context?.snapshot) {
        restoreIssueListQueries(queryClient, context.snapshot);
      }
    },
    onSuccess: (data, { id }) => {
      replaceIssueWithServerData(queryClient, id, issueToListItem(data));
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: issueKeys.lists() });
    },
  });
}

// Bulk update issues
interface BulkUpdateRequest {
  ids: string[];
  action: 'archive' | 'delete' | 'restore' | 'update';
  updates?: {
    state?: IssueState;
    assignee_id?: string | null;
    sprint_id?: string | null;
    project_id?: string | null;
  };
}

interface BulkUpdateResponse {
  updated: Issue[];
  failed: { id: string; error: string }[];
}

async function bulkUpdateIssuesApi(data: BulkUpdateRequest): Promise<BulkUpdateResponse> {
  const result = await apiClient.POST('/issues/bulk', { body: data });
  return assertApiData(result, 'Failed to bulk update issues');
}

// Hook for bulk updates
export function useBulkUpdateIssues() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: BulkUpdateRequest) => bulkUpdateIssuesApi(data),
    onMutate: async ({ ids, action, updates }) => {
      await cancelIssueListQueries(queryClient);
      const snapshot = snapshotIssueListQueries(queryClient);

      patchIssuesInMatchingLists(queryClient, (old, filters) => {
        if (action === 'archive' || action === 'delete') {
          return old.filter((issue) => !ids.includes(issue.id));
        }

        if (action === 'update' && updates) {
          const updated = old.map((issue) => {
            if (!ids.includes(issue.id)) return issue;

            let newBelongsTo = [...(issue.belongs_to || [])];

            if ('project_id' in updates) {
              newBelongsTo = newBelongsTo.filter((association) => association.type !== 'project');
              if (updates.project_id) {
                newBelongsTo.push({ id: updates.project_id, type: 'project' });
              }
            }

            if ('sprint_id' in updates) {
              newBelongsTo = newBelongsTo.filter((association) => association.type !== 'sprint');
              if (updates.sprint_id) {
                newBelongsTo.push({ id: updates.sprint_id, type: 'sprint' });
              }
            }

            const { project_id: _p, sprint_id: _s, ...directUpdates } = updates;
            return { ...issue, ...directUpdates, belongs_to: newBelongsTo } as IssueListItem;
          });
          return updated.filter((issue) => issueMatchesFilters(issue, filters));
        }

        return old;
      });

      return { snapshot };
    },
    onSuccess: (data) => {
      const updatedById = new Map(data.updated.map((issue) => [issue.id, issueToListItem(issue)]));
      const failedIds = new Set(data.failed.map((entry) => entry.id));

      patchIssueListQueries(queryClient, (old, filters) => {
        if (!old) {
          return old;
        }

        const next = old
          .map((issue) => (updatedById.has(issue.id) ? updatedById.get(issue.id)! : issue))
          .filter((issue) => !failedIds.has(issue.id) || issueMatchesFilters(issue, filters));

        return next;
      });
    },
    onError: (_err, _variables, context) => {
      if (context?.snapshot) {
        restoreIssueListQueries(queryClient, context.snapshot);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: issueKeys.lists() });
    },
  });
}

// Options for creating an issue
export interface CreateIssueOptions {
  belongs_to?: BelongsTo[];
}

// Compatibility hook that matches the old useIssues interface
export function useIssues() {
  const { data: issues = [], isLoading: loading, refetch } = useIssuesQuery();
  const createMutation = useCreateIssue();
  const updateMutation = useUpdateIssue();

  const createIssue = async (options?: CreateIssueOptions): Promise<Issue | null> => {
    try {
      return await createMutation.mutateAsync(options || {});
    } catch {
      return null;
    }
  };

  const updateIssue = async (id: string, updates: Partial<Issue>): Promise<Issue | null> => {
    try {
      return await updateMutation.mutateAsync({ id, updates });
    } catch (error) {
      // Re-throw CascadeWarningError so UI can handle it (show confirmation dialog)
      if (isCascadeWarningError(error)) {
        throw error;
      }
      return null;
    }
  };

  const refreshIssues = async (): Promise<void> => {
    await refetch();
  };

  return {
    issues,
    loading,
    createIssue,
    updateIssue,
    refreshIssues,
  };
}
