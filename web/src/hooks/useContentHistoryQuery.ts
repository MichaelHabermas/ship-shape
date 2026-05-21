import { useQuery } from '@tanstack/react-query';
import { apiGet, readJson } from '@/lib/api';

type TipTapContent = Record<string, unknown>;

export interface ContentHistoryEntry {
  id: number;
  old_content: TipTapContent | null;
  new_content: TipTapContent | null;
  created_at: string;
  changed_by: {
    id: string;
    name: string;
  } | null;
}

/**
 * Hook to fetch content version history for weekly_plan and weekly_retro documents
 */
export function useContentHistoryQuery(
  documentId: string | undefined,
  documentType: 'weekly_plan' | 'weekly_retro'
) {
  const endpoint =
    documentType === 'weekly_plan'
      ? `/api/weekly-plans/${documentId}/history`
      : `/api/weekly-retros/${documentId}/history`;

  return useQuery<ContentHistoryEntry[]>({
    queryKey: ['content-history', documentId, documentType],
    queryFn: async () => {
      const response = await apiGet(endpoint);
      if (!response.ok) {
        throw new Error('Failed to fetch content history');
      }
      return readJson<ContentHistoryEntry[]>(response);
    },
    enabled: !!documentId,
  });
}

export const contentHistoryKeys = {
  all: ['content-history'] as const,
  document: (documentId: string, documentType: string) =>
    ['content-history', documentId, documentType] as const,
};
