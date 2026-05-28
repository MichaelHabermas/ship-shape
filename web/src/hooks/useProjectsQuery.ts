import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient, assertApiData, assertApiSuccess } from '@/api/client';
import { createOptimisticProject } from '@/api/optimistic-stubs';
import { computeICEScore } from '@ship/shared';
import type {
  Project,
  ProjectIssueListItem,
  ProjectWeekListItem,
} from '@/api/schemas';

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
  const result = await apiClient.GET('/projects');
  return assertApiData(result, 'Failed to fetch projects');
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
  const result = await apiClient.POST('/projects', {
    body: {
      title: data.title ?? 'Untitled',
      impact: data.impact ?? null,
      confidence: data.confidence ?? null,
      ease: data.ease ?? null,
      owner_id: data.owner_id ?? null,
      accountable_id: data.accountable_id ?? null,
      consulted_ids: data.consulted_ids ?? [],
      informed_ids: data.informed_ids ?? [],
      color: data.color ?? '#6366f1',
      emoji: null,
      program_id: data.program_id ?? null,
      plan: data.plan ?? null,
      target_date: data.target_date ?? null,
    },
  });
  return assertApiData(result, 'Failed to create project');
}

async function updateProjectApi(id: string, updates: Partial<Project>): Promise<Project> {
  const result = await apiClient.PATCH('/projects/{id}', {
    params: { path: { id } },
    body: updates,
  });
  return assertApiData(result, 'Failed to update project');
}

async function deleteProjectApi(id: string): Promise<void> {
  const result = await apiClient.DELETE('/projects/{id}', {
    params: { path: { id } },
  });
  assertApiSuccess(result, 'Failed to delete project');
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

      const optimisticProject = createOptimisticProject(newProject);

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
  const result = await apiClient.GET('/projects/{id}/issues', {
    params: { path: { id: projectId } },
  });
  return assertApiData(result, 'Failed to fetch project issues');
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
  const result = await apiClient.GET('/projects/{id}/weeks', {
    params: { path: { id: projectId } },
  });
  return assertApiData(result, 'Failed to fetch project weeks');
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
