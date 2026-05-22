import { useQuery } from '@tanstack/react-query';
import { apiGet } from '@/lib/api';
import { createApiStatusError } from '@/lib/api-error';

export interface StandupSlot {
  date: string;
  day: string;
  standup: {
    id: string;
    title: string;
    date: string;
    created_at: string;
  } | null;
}

export interface WeekProject {
  id: string;
  title: string;
  program_name: string | null;
}

export interface MyWeekResponse {
  person_id: string;
  person_name: string;
  week: {
    week_number: number;
    current_week_number: number;
    start_date: string;
    end_date: string;
    is_current: boolean;
  };
  plan: {
    id: string;
    title: string;
    submitted_at: string | null;
    items: Array<{ text: string; checked: boolean }>;
  } | null;
  retro: {
    id: string;
    title: string;
    submitted_at: string | null;
    items: Array<{ text: string; checked: boolean }>;
  } | null;
  previous_retro: {
    id: string | null;
    title: string | null;
    submitted_at: string | null;
    week_number: number;
  } | null;
  standups: StandupSlot[];
  projects: WeekProject[];
}

async function fetchMyWeek(weekNumber?: number): Promise<MyWeekResponse> {
  const params = weekNumber ? `?week_number=${weekNumber}` : '';
  const res = await apiGet(`/api/dashboard/my-week${params}`);
  if (!res.ok) {
    throw createApiStatusError('Failed to fetch my week data', res.status);
  }
  return res.json();
}

export function useMyWeekQuery(weekNumber?: number) {
  return useQuery({
    queryKey: ['dashboard', 'my-week', weekNumber ?? 'current'],
    queryFn: () => fetchMyWeek(weekNumber),
    staleTime: 0, // Always refetch on mount — plan/retro content is saved via Yjs WebSocket so there's no client-side mutation to trigger invalidation
  });
}
