import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient, assertApiData, assertApiSuccess } from '@/api/client';
import { createOptimisticProgramSprint } from '@/api/optimistic-stubs';
import type {
  ActiveWeeksResponse,
  ProgramSprintListItem,
  ProgramSprintsResponse,
  ProjectWeekListItem,
  Week,
} from '@/api/schemas';

export type {
  ActiveWeeksResponse,
  ProgramSprintListItem,
  ProgramSprintsResponse,
  Week,
};

/** @deprecated Use ProgramSprintListItem from @/api/schemas */
export type Sprint = ProgramSprintListItem & {
  is_complete?: boolean | null;
  missing_fields?: string[];
};
// Query keys
export const sprintKeys = {
  all: ['sprints'] as const,
  lists: () => [...sprintKeys.all, 'list'] as const,
  list: (programId: string) => [...sprintKeys.lists(), programId] as const,
  projectLists: () => [...sprintKeys.all, 'projectList'] as const,
  projectList: (projectId: string) => [...sprintKeys.projectLists(), projectId] as const,
  active: () => [...sprintKeys.all, 'active'] as const,
  details: () => [...sprintKeys.all, 'detail'] as const,
  detail: (id: string) => [...sprintKeys.details(), id] as const,
};

// Fetch all active sprints across workspace
async function fetchActiveWeeks(): Promise<ActiveWeeksResponse> {
  const result = await apiClient.GET('/weeks');
  return assertApiData(result, 'Failed to fetch active sprints');
}

async function fetchSprints(programId: string): Promise<ProgramSprintsResponse> {
  const result = await apiClient.GET('/programs/{id}/sprints', {
    params: { path: { id: programId } },
  });
  return assertApiData(result, 'Failed to fetch sprints');
}

interface CreateSprintData {
  program_id: string;
  title: string;
  sprint_number: number;
  owner_id: string;
}

async function createSprintApi(data: CreateSprintData): Promise<Week> {
  const result = await apiClient.POST('/weeks', { body: data });
  return assertApiData(result, 'Failed to create sprint');
}

async function updateSprintApi(id: string, updates: Partial<Week> & { owner_id?: string }): Promise<Week> {
  const result = await apiClient.PATCH('/weeks/{id}', {
    params: { path: { id } },
    body: updates,
  });
  return assertApiData(result, 'Failed to update sprint');
}

async function deleteSprintApi(id: string): Promise<void> {
  const result = await apiClient.DELETE('/weeks/{id}', {
    params: { path: { id } },
  });
  assertApiSuccess(result, 'Failed to delete sprint');
}

export function useActiveWeeksQuery() {
  return useQuery({
    queryKey: sprintKeys.active(),
    queryFn: fetchActiveWeeks,
    staleTime: 1000 * 60 * 5,
  });
}

// Hook to get sprints for a program
export function useSprintsQuery(programId: string | undefined) {
  return useQuery({
    queryKey: programId ? sprintKeys.list(programId) : sprintKeys.lists(),
    queryFn: () => {
      if (!programId) {
        return { workspace_sprint_start_date: new Date().toISOString().split('T')[0] ?? '', weeks: [] };
      }
      return fetchSprints(programId);
    },
    enabled: !!programId,
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
}

// Hook to create sprint with optimistic update
export function useCreateSprint() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateSprintData) => createSprintApi(data),
    onMutate: async (newSprint) => {
      const programId = newSprint.program_id;
      await queryClient.cancelQueries({ queryKey: sprintKeys.list(programId) });
      const previousData = queryClient.getQueryData<ProgramSprintsResponse>(sprintKeys.list(programId));

      const optimisticSprint = createOptimisticProgramSprint({
        title: newSprint.title,
        sprint_number: newSprint.sprint_number,
      });

      queryClient.setQueryData<ProgramSprintsResponse>(
        sprintKeys.list(programId),
        (old) => old ? {
          ...old,
          weeks: [...old.weeks, optimisticSprint].sort((a, b) => a.sprint_number - b.sprint_number),
        } : {
          workspace_sprint_start_date: new Date().toISOString().split('T')[0] ?? '',
          weeks: [optimisticSprint],
        }
      );

      return { previousData, optimisticId: optimisticSprint.id, programId };
    },
    onError: (_err, newSprint, context) => {
      if (context?.previousData) {
        queryClient.setQueryData(sprintKeys.list(newSprint.program_id), context.previousData);
      }
    },
    onSuccess: (_data, _variables, context) => {
      if (context?.programId) {
        queryClient.invalidateQueries({ queryKey: sprintKeys.list(context.programId) });
      }
    },
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({ queryKey: sprintKeys.list(variables.program_id) });
    },
  });
}

// Hook to update sprint with optimistic update
export function useUpdateSprint() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, updates }: { id: string; updates: Partial<ProgramSprintListItem> & { owner_id?: string } }) =>
      updateSprintApi(id, updates),
    onMutate: async ({ id, updates }) => {
      // Find which program's cache this sprint is in
      const allProgramCaches = queryClient.getQueriesData<ProgramSprintsResponse>({
        queryKey: sprintKeys.lists(),
      });

      let programId: string | undefined;
      let previousData: ProgramSprintsResponse | undefined;

      for (const [queryKey, data] of allProgramCaches) {
        if (data?.weeks.some(s => s.id === id)) {
          programId = queryKey[2] as string;
          previousData = data;
          break;
        }
      }

      if (!programId || !previousData) {
        return { previousData: undefined, programId: undefined };
      }

      await queryClient.cancelQueries({ queryKey: sprintKeys.list(programId) });

      queryClient.setQueryData<ProgramSprintsResponse>(
        sprintKeys.list(programId),
        (old) => old ? {
          ...old,
          weeks: old.weeks.map(s => s.id === id ? { ...s, ...updates } : s),
        } : old
      );

      return { previousData, programId };
    },
    onError: (_err, _variables, context) => {
      if (context?.previousData && context?.programId) {
        queryClient.setQueryData(sprintKeys.list(context.programId), context.previousData);
      }
    },
    onSuccess: (_data, { id: _id }, context) => {
      if (context?.programId) {
        queryClient.invalidateQueries({ queryKey: sprintKeys.list(context.programId) });
      }
    },
    onSettled: (_data, _error, _variables, context) => {
      if (context?.programId) {
        queryClient.invalidateQueries({ queryKey: sprintKeys.list(context.programId) });
      }
    },
  });
}

// Hook to delete sprint with optimistic update
export function useDeleteSprint() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => deleteSprintApi(id),
    onMutate: async (id) => {
      // Find which program's cache this sprint is in
      const allProgramCaches = queryClient.getQueriesData<ProgramSprintsResponse>({
        queryKey: sprintKeys.lists(),
      });

      let programId: string | undefined;
      let previousData: ProgramSprintsResponse | undefined;

      for (const [queryKey, data] of allProgramCaches) {
        if (data?.weeks.some(s => s.id === id)) {
          programId = queryKey[2] as string;
          previousData = data;
          break;
        }
      }

      if (!programId || !previousData) {
        return { previousData: undefined, programId: undefined };
      }

      await queryClient.cancelQueries({ queryKey: sprintKeys.list(programId) });

      queryClient.setQueryData<ProgramSprintsResponse>(
        sprintKeys.list(programId),
        (old) => old ? {
          ...old,
          weeks: old.weeks.filter(s => s.id !== id),
        } : old
      );

      return { previousData, programId };
    },
    onError: (_err, _id, context) => {
      if (context?.previousData && context?.programId) {
        queryClient.setQueryData(sprintKeys.list(context.programId), context.previousData);
      }
    },
    onSettled: (_data, _error, _id, context) => {
      if (context?.programId) {
        queryClient.invalidateQueries({ queryKey: sprintKeys.list(context.programId) });
      }
    },
  });
}

// Compatibility hook that provides sprints data with the workspace start date
export function useSprints(programId: string | undefined) {
  const { data, isLoading: loading, refetch } = useSprintsQuery(programId);
  const createMutation = useCreateSprint();
  const updateMutation = useUpdateSprint();
  const deleteMutation = useDeleteSprint();

  const sprints = data?.weeks ?? [];
  const workspaceSprintStartDate = data?.workspace_sprint_start_date
    ? new Date(data.workspace_sprint_start_date)
    : new Date();

  const createSprint = async (
    sprintNumber: number,
    ownerId: string,
    title?: string
  ): Promise<Week | null> => {
    if (!programId) return null;

    try {
      return await createMutation.mutateAsync({
        program_id: programId,
        title: title || `Week ${sprintNumber}`,
        sprint_number: sprintNumber,
        owner_id: ownerId,
      });
    } catch {
      return null;
    }
  };

  const updateSprint = async (
    id: string,
    updates: Partial<Sprint> & { owner_id?: string }
  ): Promise<Week | null> => {
    try {
      return await updateMutation.mutateAsync({ id, updates });
    } catch {
      return null;
    }
  };

  const deleteSprint = async (id: string): Promise<boolean> => {
    try {
      await deleteMutation.mutateAsync(id);
      return true;
    } catch {
      return false;
    }
  };

  const refreshSprints = async (): Promise<void> => {
    await refetch();
  };

  return {
    sprints,
    loading,
    workspaceSprintStartDate,
    createSprint,
    updateSprint,
    deleteSprint,
    refreshSprints,
  };
}

// Fetch sprints for a project
async function fetchProjectSprints(projectId: string): Promise<ProjectWeekListItem[]> {
  const result = await apiClient.GET('/projects/{id}/sprints', {
    params: { path: { id: projectId } },
  });
  return assertApiData(result, 'Failed to fetch project sprints');
}

// Hook to get sprints for a project
export function useProjectSprintsQuery(projectId: string | undefined) {
  return useQuery({
    queryKey: projectId ? sprintKeys.projectList(projectId) : sprintKeys.projectLists(),
    queryFn: () => {
      if (!projectId) {
        return [];
      }
      return fetchProjectSprints(projectId);
    },
    enabled: !!projectId,
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
}

// Compatibility hook for project sprints that matches useSprints interface
export function useProjectSprints(projectId: string | undefined) {
  const { data, isLoading: loading, refetch } = useProjectSprintsQuery(projectId);

  const sprints = data ?? [];
  // Get workspace sprint start date from first sprint or default to now
  const workspaceSprintStartDate = data?.[0]?.workspace_sprint_start_date
    ? new Date(data[0].workspace_sprint_start_date)
    : new Date();

  const refreshSprints = async (): Promise<void> => {
    await refetch();
  };

  return {
    sprints,
    loading,
    workspaceSprintStartDate,
    refreshSprints,
  };
}
