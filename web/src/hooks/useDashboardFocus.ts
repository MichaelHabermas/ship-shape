import { useQuery } from '@tanstack/react-query';
import { apiGet } from '@/lib/api';
import { createApiStatusError } from '@/lib/api-error';

export interface PlanItem {
  text: string;
  checked: boolean;
}

export interface RecentActivity {
  id: string;
  title: string;
  ticket_number: number | null;
  state: string;
  updated_at: string;
}

export interface ProjectFocus {
  id: string;
  title: string;
  program_name: string;
  plan: {
    id: string | null;
    week_number: number;
    items: PlanItem[];
  } | null;
  previous_plan: {
    id: string | null;
    week_number: number;
    items: PlanItem[];
  } | null;
  recent_activity: RecentActivity[];
}

export interface FocusResponse {
  person_id: string | null;
  current_week_number: number;
  week_start: string;
  week_end: string;
  projects: ProjectFocus[];
}

async function fetchFocus(): Promise<FocusResponse> {
  const res = await apiGet('/api/dashboard/my-focus');
  if (!res.ok) {
    throw createApiStatusError('Failed to fetch focus data', res.status);
  }
  return res.json();
}

export function useDashboardFocus() {
  return useQuery({
    queryKey: ['dashboard', 'my-focus'],
    queryFn: fetchFocus,
    staleTime: 1000 * 60 * 5,
  });
}
