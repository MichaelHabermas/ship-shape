import { useQuery } from '@tanstack/react-query';
import { apiGet, readJson } from '@/lib/api';
import { createApiStatusError } from '@/lib/api-error';

export interface BreadcrumbItem {
  id: string;
  title: string;
  type: string;
  ticket_number?: number;
}

export interface ContextDocument {
  id: string;
  title: string;
  document_type: string;
  ticket_number?: number;
  depth?: number;
  child_count?: number;
}

export interface BelongsToItem {
  type: 'project' | 'sprint' | 'program';
  id: string;
  title: string;
  document_type: string;
  color?: string;
}

export interface DocumentContext {
  current: ContextDocument & {
    program_id?: string;
    program_name?: string;
    program_color?: string;
  };
  ancestors: ContextDocument[];
  children: (ContextDocument & { child_count: number })[];
  belongs_to: BelongsToItem[];
  breadcrumbs: BreadcrumbItem[];
}

// Query keys
export const documentContextKeys = {
  all: ['documentContext'] as const,
  detail: (id: string) => [...documentContextKeys.all, id] as const,
};

// Fetch document context
async function fetchDocumentContext(id: string): Promise<DocumentContext> {
  const res = await apiGet(`/api/documents/${id}/context`);
  if (!res.ok) {
    throw createApiStatusError('Failed to fetch document context', res.status);
  }
  return readJson<DocumentContext>(res);
}

// Hook to get document context (ancestors + children + breadcrumbs)
export function useDocumentContextQuery(id: string | undefined) {
  return useQuery({
    queryKey: documentContextKeys.detail(id || ''),
    queryFn: () => {
      if (!id) throw new Error('Document id is required');
      return fetchDocumentContext(id);
    },
    enabled: !!id,
    staleTime: 1000 * 60 * 2, // 2 minutes
    refetchOnMount: 'always',
  });
}
