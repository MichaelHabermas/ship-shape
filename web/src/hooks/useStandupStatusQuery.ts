import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGetJson } from '@/lib/api';
import type { StandupStatus } from '@/api/schemas';

export type { StandupStatus };

// Query keys
export const standupStatusKeys = {
  all: ['standup-status'] as const,
  status: () => [...standupStatusKeys.all, 'status'] as const,
};

// Fetch standup status
async function fetchStandupStatus(): Promise<StandupStatus> {
  return apiGetJson<StandupStatus>('/api/standups/status', 'Failed to fetch standup status');
}

// Hook to get standup due status
export function useStandupStatusQuery() {
  return useQuery({
    queryKey: standupStatusKeys.status(),
    queryFn: fetchStandupStatus,
    staleTime: 1000 * 60 * 2, // 2 minutes
    refetchInterval: 1000 * 60 * 5, // Refetch every 5 minutes for real-time updates
  });
}

// Hook to invalidate standup status (call after posting a standup)
export function useInvalidateStandupStatus() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: standupStatusKeys.all });
}
