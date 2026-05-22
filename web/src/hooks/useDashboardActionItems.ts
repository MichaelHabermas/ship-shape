import { useQuery } from '@tanstack/react-query';
import { apiGet } from '@/lib/api';
import { createApiStatusError } from '@/lib/api-error';

export interface ActionItem {
  id: string;
  type: 'plan' | 'retro';
  sprint_id: string;
  sprint_title: string;
  program_id: string;
  program_name: string;
  sprint_number: number;
  urgency: 'overdue' | 'due_today' | 'due_soon' | 'upcoming';
  days_until_due: number;
  message: string;
}

export interface ActionItemsResponse {
  action_items: ActionItem[];
}

async function fetchActionItems(): Promise<ActionItemsResponse> {
  const res = await apiGet('/api/weeks/my-action-items');
  if (!res.ok) {
    throw createApiStatusError('Failed to fetch action items', res.status);
  }
  return res.json();
}

export function useDashboardActionItems() {
  return useQuery({
    queryKey: ['dashboard', 'action-items'],
    queryFn: fetchActionItems,
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
}
