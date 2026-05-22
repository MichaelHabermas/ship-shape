import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost, apiPatch, apiDelete } from '@/lib/api';
import { createApiStatusError } from '@/lib/api-error';

export interface ProgramOwner {
  id: string;
  name: string;
  email: string;
}

export interface Program {
  id: string;
  name: string;
  color: string;
  emoji?: string | null;
  archived_at: string | null;
  created_at?: string;
  updated_at?: string;
  issue_count?: number;
  sprint_count?: number;
  owner: ProgramOwner | null;
}

// Query keys
export const programKeys = {
  all: ['programs'] as const,
  lists: () => [...programKeys.all, 'list'] as const,
  list: (filters?: Record<string, unknown>) => [...programKeys.lists(), filters] as const,
  details: () => [...programKeys.all, 'detail'] as const,
  detail: (id: string) => [...programKeys.details(), id] as const,
};

// Fetch programs
async function fetchPrograms(): Promise<Program[]> {
  const res = await apiGet('/api/programs');
  if (!res.ok) {
    throw createApiStatusError('Failed to fetch programs', res.status);
  }
  return res.json();
}

// Create program
async function createProgramApi(data: { title: string }): Promise<Program> {
  const res = await apiPost('/api/programs', data);
  if (!res.ok) {
    throw createApiStatusError('Failed to create program', res.status);
  }
  return res.json();
}

// Update program
async function updateProgramApi(id: string, updates: Record<string, unknown>): Promise<Program> {
  const res = await apiPatch(`/api/programs/${id}`, updates);
  if (!res.ok) {
    throw createApiStatusError('Failed to update program', res.status);
  }
  return res.json();
}

// Delete program
async function deleteProgramApi(id: string): Promise<void> {
  const res = await apiDelete(`/api/programs/${id}`);
  if (!res.ok) {
    throw createApiStatusError('Failed to delete program', res.status);
  }
}

// Hook to get programs
export function useProgramsQuery() {
  return useQuery({
    queryKey: programKeys.lists(),
    queryFn: fetchPrograms,
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
}

// Hook to create program with optimistic update
export function useCreateProgram() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data?: { title?: string }) =>
      createProgramApi({ title: data?.title ?? 'Untitled' }),
    onMutate: async (newProgram) => {
      await queryClient.cancelQueries({ queryKey: programKeys.lists() });
      const previousPrograms = queryClient.getQueryData<Program[]>(programKeys.lists());

      const optimisticProgram: Program = {
        id: `temp-${crypto.randomUUID()}`,
        name: newProgram?.title ?? 'Untitled',
        color: '#6B7280',
        emoji: null,
        archived_at: null,
        issue_count: 0,
        sprint_count: 0,
        owner: null,
      };

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

// Hook to update program with optimistic update
export function useUpdateProgram() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, updates }: { id: string; updates: Partial<Program> & { owner_id?: string | null } }) => {
      // Map frontend field names to API field names
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

// Hook to delete program with optimistic update
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

// Compatibility hook that matches the old usePrograms interface
export function usePrograms() {
  const { data: programs = [], isLoading: loading, refetch } = useProgramsQuery();
  const createMutation = useCreateProgram();
  const updateMutation = useUpdateProgram();
  const deleteMutation = useDeleteProgram();

  const createProgram = async (): Promise<Program | null> => {
    try {
      return await createMutation.mutateAsync({});
    } catch {
      return null;
    }
  };

  const updateProgram = async (id: string, updates: Partial<Program> & { owner_id?: string | null }): Promise<Program | null> => {
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
