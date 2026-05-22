import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient, assertApiData, assertApiSuccess } from '@/api/client';
import { createOptimisticProgram } from '@/api/optimistic-stubs';
import type { Program, UserReference } from '@/api/schemas';

export type { Program };
export type ProgramOwner = UserReference;

export const programKeys = {
  all: ['programs'] as const,
  lists: () => [...programKeys.all, 'list'] as const,
  list: (filters?: Record<string, unknown>) => [...programKeys.lists(), filters] as const,
  details: () => [...programKeys.all, 'detail'] as const,
  detail: (id: string) => [...programKeys.details(), id] as const,
};

async function fetchPrograms(): Promise<Program[]> {
  const result = await apiClient.GET('/programs');
  return assertApiData(result, 'Failed to fetch programs');
}

async function createProgramApi(data: { title: string }): Promise<Program> {
  const result = await apiClient.POST('/programs', {
    body: {
      title: data.title,
      color: '#6366f1',
      owner_id: null,
      accountable_id: null,
      consulted_ids: [],
      informed_ids: [],
    },
  });
  return assertApiData(result, 'Failed to create program');
}

async function updateProgramApi(id: string, updates: Record<string, unknown>): Promise<Program> {
  const result = await apiClient.PATCH('/programs/{id}', {
    params: { path: { id } },
    body: updates,
  });
  return assertApiData(result, 'Failed to update program');
}

async function deleteProgramApi(id: string): Promise<void> {
  const result = await apiClient.DELETE('/programs/{id}', {
    params: { path: { id } },
  });
  assertApiSuccess(result, 'Failed to delete program');
}

export function useProgramsQuery() {
  return useQuery({
    queryKey: programKeys.lists(),
    queryFn: fetchPrograms,
    staleTime: 1000 * 60 * 5,
  });
}

export function useCreateProgram() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data?: { title?: string }) =>
      createProgramApi({ title: data?.title ?? 'Untitled' }),
    onMutate: async (newProgram) => {
      await queryClient.cancelQueries({ queryKey: programKeys.lists() });
      const previousPrograms = queryClient.getQueryData<Program[]>(programKeys.lists());

      const optimisticProgram = createOptimisticProgram(newProgram ?? {});

      queryClient.setQueryData<Program[]>(
        programKeys.lists(),
        (old) => [optimisticProgram, ...(old || [])]
      );

      return { previousPrograms, optimisticId: optimisticProgram.id };
    },
    onError: (_err, _newProgram, context) => {
      if (context?.previousPrograms) {
        queryClient.setQueryData(programKeys.lists(), context.previousPrograms);
      }
    },
    onSuccess: (data, _variables, context) => {
      if (context?.optimisticId) {
        queryClient.setQueryData<Program[]>(
          programKeys.lists(),
          (old) => old?.map(p => p.id === context.optimisticId ? data : p) || [data]
        );
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: programKeys.lists() });
    },
  });
}

export function useUpdateProgram() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, updates }: { id: string; updates: Partial<Program> & { owner_id?: string | null } }) => {
      const apiUpdates: Record<string, unknown> = {};
      if (updates.name !== undefined) apiUpdates.title = updates.name;
      if (updates.color !== undefined) apiUpdates.color = updates.color;
      if (updates.archived_at !== undefined) apiUpdates.archived_at = updates.archived_at;
      if (updates.owner_id !== undefined) apiUpdates.owner_id = updates.owner_id;
      return updateProgramApi(id, apiUpdates);
    },
    onMutate: async ({ id, updates }) => {
      await queryClient.cancelQueries({ queryKey: programKeys.lists() });
      const previousPrograms = queryClient.getQueryData<Program[]>(programKeys.lists());

      queryClient.setQueryData<Program[]>(
        programKeys.lists(),
        (old) => old?.map(p => p.id === id ? { ...p, ...updates } : p) || []
      );

      return { previousPrograms };
    },
    onError: (_err, _variables, context) => {
      if (context?.previousPrograms) {
        queryClient.setQueryData(programKeys.lists(), context.previousPrograms);
      }
    },
    onSuccess: (data, { id }) => {
      queryClient.setQueryData<Program[]>(
        programKeys.lists(),
        (old) => old?.map(p => p.id === id ? { ...p, ...data } : p) || []
      );
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: programKeys.lists() });
    },
  });
}

export function useDeleteProgram() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => deleteProgramApi(id),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: programKeys.lists() });
      const previousPrograms = queryClient.getQueryData<Program[]>(programKeys.lists());

      queryClient.setQueryData<Program[]>(
        programKeys.lists(),
        (old) => old?.filter(p => p.id !== id) || []
      );

      return { previousPrograms };
    },
    onError: (_err, _id, context) => {
      if (context?.previousPrograms) {
        queryClient.setQueryData(programKeys.lists(), context.previousPrograms);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: programKeys.lists() });
    },
  });
}

export function usePrograms() {
  const { data: programs = [], isLoading: loading, refetch } = useProgramsQuery();
  const createMutation = useCreateProgram();
  const updateMutation = useUpdateProgram();
  const deleteMutation = useDeleteProgram();

  const createProgram = async (options?: { title?: string }): Promise<Program | null> => {
    try {
      return await createMutation.mutateAsync(options);
    } catch {
      return null;
    }
  };

  const updateProgram = async (id: string, updates: Partial<Program>): Promise<Program | null> => {
    try {
      return await updateMutation.mutateAsync({ id, updates });
    } catch {
      return null;
    }
  };

  const deleteProgram = async (id: string): Promise<boolean> => {
    try {
      await deleteMutation.mutateAsync(id);
      return true;
    } catch {
      return false;
    }
  };

  const refreshPrograms = async (): Promise<void> => {
    await refetch();
  };

  return {
    programs,
    loading,
    createProgram,
    updateProgram,
    deleteProgram,
    refreshPrograms,
  };
}
