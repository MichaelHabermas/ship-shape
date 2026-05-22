import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiPost, apiPatch, readJson } from '@/lib/api';
import { createApiStatusError } from '@/lib/api-error';
import { apiClient, assertApiData } from '@/api/client';
import type { CascadeWarning, IncompleteChild, BelongsTo, BelongsToType } from '@ship/shared';

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

export interface Issue {
  id: string;
  title: string;
  state: string;
  priority: string;
  ticket_number?: number;
  display_id?: string;
  assignee_id?: string | null;
  assignee_name?: string | null;
  assignee_archived?: boolean;
  estimate?: number | null;
  // belongs_to array contains all associations (program, sprint, project, parent)
  belongs_to: BelongsTo[];
  source: 'internal' | 'external';
  rejection_reason?: string | null;
  created_at?: string;
  updated_at?: string;
  created_by?: string;
  started_at?: string | null;
  completed_at?: string | null;
  cancelled_at?: string | null;
  reopened_at?: string | null;
  converted_from_id?: string | null;
}

// Helper to extract association ID by type
export function getAssociationId(issue: Issue, type: BelongsToType): string | null {
  const association = issue.belongs_to?.find(a => a.type === type);
  return association?.id ?? null;
}

// Helper to get program ID from belongs_to
export function getProgramId(issue: Issue): string | null {
  return getAssociationId(issue, 'program');
}

// Helper to get sprint ID from belongs_to
export function getSprintId(issue: Issue): string | null {
  return getAssociationId(issue, 'sprint');
}

// Helper to get project ID from belongs_to
export function getProjectId(issue: Issue): string | null {
  return getAssociationId(issue, 'project');
}

// Helper to get association title by type (e.g., program name)
export function getAssociationTitle(issue: Issue, type: BelongsToType): string | null {
  const association = issue.belongs_to?.find(a => a.type === type);
  return association?.title ?? null;
}

// Helper to get program title from belongs_to
export function getProgramTitle(issue: Issue): string | null {
  return getAssociationTitle(issue, 'program');
}

// Helper to get project title from belongs_to
export function getProjectTitle(issue: Issue): string | null {
  return getAssociationTitle(issue, 'project');
}

// Helper to get sprint title from belongs_to
export function getSprintTitle(issue: Issue): string | null {
  return getAssociationTitle(issue, 'sprint');
}

// Filter interface for locked context
export interface IssueFilters {
  programId?: string;
  projectId?: string;
  sprintId?: string;
}

// Query keys
export const issueKeys = {
  all: ['issues'] as const,
  lists: () => [...issueKeys.all, 'list'] as const,
  list: (filters?: IssueFilters) => [...issueKeys.lists(), filters] as const,
  details: () => [...issueKeys.all, 'detail'] as const,
  detail: (id: string) => [...issueKeys.details(), id] as const,
};

// Transform API issue response to Issue type
function transformIssue(apiIssue: Record<string, unknown>): Issue {
  const belongs_to = (apiIssue.belongs_to as BelongsTo[]) || [];

  return {
    ...apiIssue,
    belongs_to,
  } as Issue;
}

// Fetch issues with optional filters
async function fetchIssues(filters?: IssueFilters): Promise<Issue[]> {
  const result = await apiClient.GET('/issues', {
    params: {
      query: {
        ...(filters?.programId ? { program_id: filters.programId } : {}),
        ...(filters?.projectId ? { project_id: filters.projectId } : {}),
        ...(filters?.sprintId ? { sprint_id: filters.sprintId } : {}),
      },
    },
  });
  const data = assertApiData(result, 'Failed to fetch issues');
  return (data as Record<string, unknown>[]).map(transformIssue);
}

// Create issue
interface CreateIssueData {
  title?: string;
  belongs_to?: BelongsTo[];
}

async function createIssueApi(data: CreateIssueData): Promise<Issue> {
  const apiData: Record<string, unknown> = { title: data.title ?? 'Untitled' };
  if (data.belongs_to && data.belongs_to.length > 0) {
    apiData.belongs_to = data.belongs_to;
  }

  const res = await apiPost('/api/issues', apiData);
  if (!res.ok) {
    throw createApiStatusError('Failed to create issue', res.status);
  }
  const apiIssue = await readJson<Record<string, unknown>>(res);
  return transformIssue(apiIssue);
}

// Update issue
async function updateIssueApi(id: string, updates: Partial<Issue>): Promise<Issue> {
  // API accepts belongs_to directly - no conversion needed
  const res = await apiPatch(`/api/issues/${id}`, updates);
  if (!res.ok) {
    // Check for cascade warning (409 with incomplete_children)
    if (res.status === 409) {
      const body = await readJson<{ error?: string } & CascadeWarning>(res);
      if (body.error === 'incomplete_children') {
        throw new CascadeWarningError(body);
      }
    }
    throw createApiStatusError('Failed to update issue', res.status);
  }
  const apiIssue = await readJson<Record<string, unknown>>(res);
  return transformIssue(apiIssue);
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
      await queryClient.cancelQueries({ queryKey: issueKeys.lists() });
      const previousIssues = queryClient.getQueryData<Issue[]>(issueKeys.lists());

      // Use belongs_to directly from input
      const belongs_to: BelongsTo[] = newIssue?.belongs_to || [];

      const optimisticIssue: Issue = {
        id: `temp-${crypto.randomUUID()}`,
        title: newIssue?.title ?? 'Untitled',
        state: 'backlog',
        priority: 'none',
        ticket_number: -1,
        display_id: 'PENDING',
        assignee_id: null,
        assignee_name: null,
        estimate: null,
        belongs_to,
        source: 'internal',
        rejection_reason: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      queryClient.setQueryData<Issue[]>(
        issueKeys.lists(),
        (old) => [optimisticIssue, ...(old || [])]
      );

      return { previousIssues, optimisticId: optimisticIssue.id };
    },
    onError: (_err, _newIssue, context) => {
      if (context?.previousIssues) {
        queryClient.setQueryData(issueKeys.lists(), context.previousIssues);
      }
    },
    onSuccess: (data, _variables, context) => {
      if (context?.optimisticId) {
        queryClient.setQueryData<Issue[]>(
          issueKeys.lists(),
          (old) => old?.map(i => i.id === context.optimisticId ? data : i) || [data]
        );
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
      await queryClient.cancelQueries({ queryKey: issueKeys.lists() });
      const previousIssues = queryClient.getQueryData<Issue[]>(issueKeys.lists());

      queryClient.setQueryData<Issue[]>(
        issueKeys.lists(),
        (old) => old?.map(i => {
          if (i.id !== id) return i;

          // Merge belongs_to: if updates contains belongs_to, use it; otherwise keep existing
          const newBelongsTo = updates.belongs_to ?? i.belongs_to ?? [];

          return { ...i, ...updates, belongs_to: newBelongsTo };
        }) || []
      );

      return { previousIssues };
    },
    onError: (_err, _variables, context) => {
      if (context?.previousIssues) {
        queryClient.setQueryData(issueKeys.lists(), context.previousIssues);
      }
    },
    onSuccess: (data, { id }) => {
      queryClient.setQueryData<Issue[]>(
        issueKeys.lists(),
        (old) => old?.map(i => i.id === id ? data : i) || []
      );
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
    state?: string;
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
  const res = await apiPost('/api/issues/bulk', data);
  if (!res.ok) {
    throw createApiStatusError('Failed to bulk update issues', res.status);
  }
  return readJson<BulkUpdateResponse>(res);
}

// Hook for bulk updates
export function useBulkUpdateIssues() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: BulkUpdateRequest) => bulkUpdateIssuesApi(data),
    onMutate: async ({ ids, action, updates }) => {
      await queryClient.cancelQueries({ queryKey: issueKeys.lists() });
      const previousIssues = queryClient.getQueryData<Issue[]>(issueKeys.lists());

      queryClient.setQueryData<Issue[]>(issueKeys.lists(), (old) => {
        if (!old) return old;

        if (action === 'archive' || action === 'delete') {
          return old.filter(i => !ids.includes(i.id));
        }

        if (action === 'update' && updates) {
          return old.map(i => {
            if (!ids.includes(i.id)) return i;

            // Start with existing belongs_to
            let newBelongsTo = [...(i.belongs_to || [])];

            // Handle project_id update: update or add project association
            if ('project_id' in updates) {
              newBelongsTo = newBelongsTo.filter(a => a.type !== 'project');
              if (updates.project_id) {
                newBelongsTo.push({ id: updates.project_id, type: 'project' });
              }
            }

            // Handle sprint_id update: update or add sprint association
            if ('sprint_id' in updates) {
              newBelongsTo = newBelongsTo.filter(a => a.type !== 'sprint');
              if (updates.sprint_id) {
                newBelongsTo.push({ id: updates.sprint_id, type: 'sprint' });
              }
            }

            // Apply state and assignee_id updates directly
            const { project_id: _p, sprint_id: _s, ...directUpdates } = updates;
            return { ...i, ...directUpdates, belongs_to: newBelongsTo };
          });
        }

        return old;
      });

      return { previousIssues };
    },
    onError: (_err, _variables, context) => {
      if (context?.previousIssues) {
        queryClient.setQueryData(issueKeys.lists(), context.previousIssues);
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
