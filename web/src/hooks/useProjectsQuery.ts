import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost, apiPatch, apiDelete, readJson } from '@/lib/api';
import { createApiStatusError } from '@/lib/api-error';
import { computeICEScore } from '@ship/shared';
import type {
  Project,
  ProjectIssueListItem,
  ProjectWeekListItem,
} from '@/api/schemas';

export type { InferredProjectStatus } from '@ship/shared';
export type { Project, ProjectIssueListItem, ProjectWeekListItem };
export type ProjectIssue = ProjectIssueListItem;
export type ProjectWeek = ProjectWeekListItem;

// Query keys
export const projectKeys = {
  all: ['projects'] as const,
  lists: () => [...projectKeys.all, 'list'] as const,
  list: (filters?: Record<string, unknown>) => [...projectKeys.lists(), filters] as const,
  details: () => [...projectKeys.all, 'detail'] as const,
  detail: (id: string) => [...projectKeys.details(), id] as const,
  issues: (id: string) => [...projectKeys.detail(id), 'issues'] as const,
  weeks: (id: string) => [...projectKeys.detail(id), 'weeks'] as const,
};

// Fetch projects
async function fetchProjects(): Promise<Project[]> {
  const res = await apiGet('/api/projects');
  if (!res.ok) {
    throw createApiStatusError('Failed to fetch projects', res.status);
  }
  return readJson<Project[]>(res);
}

// Create project
interface CreateProjectData {
  title?: string;
  owner_id?: string | null;  // R - Responsible (optional - can be unassigned)
  accountable_id?: string | null;  // A - Accountable (approver)
  consulted_ids?: string[];        // C - Consulted
  informed_ids?: string[];         // I - Informed
  impact?: number | null;
  confidence?: number | null;
  ease?: number | null;
  color?: string;
  program_id?: string;
  plan?: string;
  target_date?: string;
}

async function createProjectApi(data: CreateProjectData): Promise<Project> {
  const res = await apiPost('/api/projects', data);
  if (!res.ok) {
    throw createApiStatusError('Failed to create project', res.status);
  }
  return readJson<Project>(res);
}

// Update project
async function updateProjectApi(id: string, updates: Partial<Project>): Promise<Project> {
  const res = await apiPatch(`/api/projects/${id}`, updates);
  if (!res.ok) {
    throw createApiStatusError('Failed to update project', res.status);
  }
  return readJson<Project>(res);
}

// Delete project
async function deleteProjectApi(id: string): Promise<void> {
  const res = await apiDelete(`/api/projects/${id}`);
  if (!res.ok) {
    throw createApiStatusError('Failed to delete project', res.status);
  }
}

// Hook to get projects
export function useProjectsQuery() {
  return useQuery({
    queryKey: projectKeys.lists(),
    queryFn: fetchProjects,
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
}

// Hook to create project with optimistic update
export function useCreateProject() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateProjectData) => createProjectApi(data),
    onMutate: async (newProject) => {
      await queryClient.cancelQueries({ queryKey: projectKeys.lists() });
      const previousProjects = queryClient.getQueryData<Project[]>(projectKeys.lists());

      // ICE values default to null (not yet set)
      const impact = newProject.impact ?? null;
      const confidence = newProject.confidence ?? null;
      const ease = newProject.ease ?? null;

      const optimisticProject = {
        id: `temp-${crypto.randomUUID()}`,
        title: newProject.title ?? 'Untitled',
        impact,
        confidence,
        ease,
        ice_score: computeICEScore(impact, confidence, ease),
        color: newProject.color ?? '#6366f1',
        emoji: null,
        program_id: newProject.program_id ?? null,
        owner: null,
        owner_id: newProject.owner_id ?? null,
        accountable_id: newProject.accountable_id ?? null,
        consulted_ids: newProject.consulted_ids ?? [],
        informed_ids: newProject.informed_ids ?? [],
        plan: newProject.plan ?? null,
        plan_approval: null,
        retro_approval: null,
        has_retro: false,
        has_design_review: null,
        design_review_notes: null,
        target_date: newProject.target_date ?? null,
        sprint_count: 0,
        issue_count: 0,
        inferred_status: 'backlog' as const,
        archived_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        is_complete: null,
        missing_fields: [],
        converted_from_id: null,
      } as unknown as Project;

      queryClient.setQueryData<Project[]>(
        projectKeys.lists(),
        (old) => [optimisticProject, ...(old || [])]
      );

      return { previousProjects, optimisticId: optimisticProject.id };
    },
    onError: (_err, _newProject, context) => {
      if (context?.previousProjects) {
        queryClient.setQueryData(projectKeys.lists(), context.previousProjects);
      }
    },
    onSuccess: (data, _variables, context) => {
      if (context?.optimisticId) {
        queryClient.setQueryData<Project[]>(
          projectKeys.lists(),
          (old) => old?.map(p => p.id === context.optimisticId ? data : p) || [data]
        );
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: projectKeys.lists() });
    },
  });
}

// Hook to update project with optimistic update
export function useUpdateProject() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, updates }: { id: string; updates: Partial<Project> }) =>
      updateProjectApi(id, updates),
    onMutate: async ({ id, updates }) => {
      await queryClient.cancelQueries({ queryKey: projectKeys.lists() });
      const previousProjects = queryClient.getQueryData<Project[]>(projectKeys.lists());

      queryClient.setQueryData<Project[]>(
        projectKeys.lists(),
        (old) => old?.map(p => {
          if (p.id === id) {
            const updated = { ...p, ...updates };
            // Recompute ICE score if any ICE property changed
            if (updates.impact !== undefined || updates.confidence !== undefined || updates.ease !== undefined) {
              const impact = updates.impact ?? p.impact;
              const confidence = updates.confidence ?? p.confidence;
              const ease = updates.ease ?? p.ease;
              updated.ice_score = computeICEScore(impact, confidence, ease);
            }
            return updated;
          }
          return p;
        }) || []
      );

      return { previousProjects };
    },
    onError: (_err, _variables, context) => {
      if (context?.previousProjects) {
        queryClient.setQueryData(projectKeys.lists(), context.previousProjects);
      }
    },
    onSuccess: (data, { id }) => {
      queryClient.setQueryData<Project[]>(
        projectKeys.lists(),
        (old) => old?.map(p => p.id === id ? data : p) || []
      );
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: projectKeys.lists() });
    },
  });
}

// Hook to delete project
export function useDeleteProject() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => deleteProjectApi(id),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: projectKeys.lists() });
      const previousProjects = queryClient.getQueryData<Project[]>(projectKeys.lists());

      queryClient.setQueryData<Project[]>(
        projectKeys.lists(),
        (old) => old?.filter(p => p.id !== id) || []
      );

      return { previousProjects };
    },
    onError: (_err, _id, context) => {
      if (context?.previousProjects) {
        queryClient.setQueryData(projectKeys.lists(), context.previousProjects);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: projectKeys.lists() });
    },
  });
}

// Options for creating a project
export interface CreateProjectOptions {
  title?: string;
  owner_id?: string | null;  // R - Responsible (optional - can be unassigned)
  accountable_id?: string | null;  // A - Accountable (approver)
  consulted_ids?: string[];        // C - Consulted
  informed_ids?: string[];         // I - Informed
  program_id?: string;
  plan?: string;
  target_date?: string;
}

// Compatibility hook that matches the context interface
export function useProjects() {
  const { data: projects = [], isLoading: loading, refetch } = useProjectsQuery();
  const createMutation = useCreateProject();
  const updateMutation = useUpdateProject();
  const deleteMutation = useDeleteProject();

  const createProject = async (options: CreateProjectOptions): Promise<Project | null> => {
    try {
      return await createMutation.mutateAsync(options);
    } catch {
      return null;
    }
  };

  const updateProject = async (id: string, updates: Partial<Project>): Promise<Project | null> => {
    try {
      return await updateMutation.mutateAsync({ id, updates });
    } catch {
      return null;
    }
  };

  const deleteProject = async (id: string): Promise<boolean> => {
    try {
      await deleteMutation.mutateAsync(id);
      return true;
    } catch {
      return false;
    }
  };

  const refreshProjects = async (): Promise<void> => {
    await refetch();
  };

  return {
    projects,
    loading,
    createProject,
    updateProject,
    deleteProject,
    refreshProjects,
  };
}

// Fetch project issues
async function fetchProjectIssues(projectId: string): Promise<ProjectIssue[]> {
  const res = await apiGet(`/api/projects/${projectId}/issues`);
  if (!res.ok) {
    throw createApiStatusError('Failed to fetch project issues', res.status);
  }
  return readJson<ProjectIssue[]>(res);
}

// Hook to get project issues
export function useProjectIssuesQuery(projectId: string | undefined) {
  return useQuery({
    queryKey: projectId ? projectKeys.issues(projectId) : ['disabled'],
    queryFn: () => {
      if (!projectId) throw new Error('Project id is required');
      return fetchProjectIssues(projectId);
    },
    enabled: !!projectId,
    staleTime: 1000 * 60 * 2, // 2 minutes
  });
}

// Fetch project weeks
async function fetchProjectWeeks(projectId: string): Promise<ProjectWeek[]> {
  const res = await apiGet(`/api/projects/${projectId}/weeks`);
  if (!res.ok) {
    throw createApiStatusError('Failed to fetch project weeks', res.status);
  }
  return readJson<ProjectWeek[]>(res);
}

// Hook to get project weeks
export function useProjectWeeksQuery(projectId: string | undefined) {
  return useQuery({
    queryKey: projectId ? projectKeys.weeks(projectId) : ['disabled'],
    queryFn: () => {
      if (!projectId) throw new Error('Project id is required');
      return fetchProjectWeeks(projectId);
    },
    enabled: !!projectId,
    staleTime: 1000 * 60 * 2, // 2 minutes
  });
}
