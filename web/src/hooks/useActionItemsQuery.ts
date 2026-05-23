import { useQuery } from '@tanstack/react-query';
import { apiClient, assertApiData } from '@/api/client';
import type { components } from '@/api/generated/ship-openapi';

export type ActionItem = components['schemas']['InferredActionItem'] & {
  person_id?: string | null;
  project_id?: string | null;
  week_number?: number | null;
};

type ActionItemsResponse = components['schemas']['AccountabilityActionItemsResponse'] & {
  items: ActionItem[];
};

export const actionItemsKeys = {
  all: ['action-items'] as const,
  list: () => [...actionItemsKeys.all, 'list'] as const,
};

export function useActionItemsQuery() {
  return useQuery<ActionItemsResponse>({
    queryKey: actionItemsKeys.list(),
    queryFn: async () => {
      const response = await apiClient.GET('/accountability/action-items');
      return assertApiData(response, 'Failed to fetch action items') as ActionItemsResponse;
    },
    staleTime: 30 * 1000,
    refetchInterval: 60 * 1000,
  });
}
