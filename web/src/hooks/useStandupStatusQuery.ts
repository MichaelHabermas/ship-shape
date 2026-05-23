import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient, assertApiData } from '@/api/client';
import type { components } from '@/api/generated/ship-openapi';

export type StandupStatus = components['schemas']['StandupStatus'];

export const standupStatusKeys = {
  all: ['standup-status'] as const,
  status: () => [...standupStatusKeys.all, 'status'] as const,
};

async function fetchStandupStatus(): Promise<StandupStatus> {
  const response = await apiClient.GET('/standups/status');
  return assertApiData(response, 'Failed to fetch standup status');
}

export function useStandupStatusQuery() {
  return useQuery({
    queryKey: standupStatusKeys.status(),
    queryFn: fetchStandupStatus,
    staleTime: 1000 * 60 * 2,
    refetchInterval: 1000 * 60 * 5,
  });
}

export function useInvalidateStandupStatus() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: standupStatusKeys.all });
}
