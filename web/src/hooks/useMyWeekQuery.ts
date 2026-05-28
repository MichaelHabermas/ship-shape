import { useQuery } from '@tanstack/react-query';
import type { MyWeekResponse } from '@/api/schemas';
import { apiGetJson } from '@/lib/api';

export type { MyWeekResponse, StandupSlot, WeekProject } from '@/api/schemas';

async function fetchMyWeek(weekNumber?: number): Promise<MyWeekResponse> {
  const params = weekNumber ? `?week_number=${weekNumber}` : '';
  return apiGetJson<MyWeekResponse>(`/api/dashboard/my-week${params}`, 'Failed to fetch my week data');
}

export function useMyWeekQuery(weekNumber?: number) {
  return useQuery({
    queryKey: ['dashboard', 'my-week', weekNumber ?? 'current'],
    queryFn: () => fetchMyWeek(weekNumber),
    staleTime: 0, // Always refetch on mount — plan/retro content is saved via Yjs WebSocket so there's no client-side mutation to trigger invalidation
  });
}
