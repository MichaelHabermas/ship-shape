import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost, apiPatch, apiDelete } from '@/lib/api';
import { createApiStatusError } from '@/lib/api-error';

export interface WikiDocument {
  id: string;
  title: string;
  document_type: string;
  parent_id: string | null;
  position: number;
  created_at: string;
  updated_at: string;
  created_by?: string | null;
  properties?: Record<string, unknown>;
  visibility: 'private' | 'workspace';
}

// Query keys
export const documentKeys = {
  all: ['documents'] as const,
  lists: () => [...documentKeys.all, 'list'] as const,
  list: (type: string) => [...documentKeys.lists(), type] as const,
  wikiList: () => [...documentKeys.all, 'wiki'] as const,
  details: () => [...documentKeys.all, 'detail'] as const,
  detail: (id: string) => [...documentKeys.details(), id] as const,
};

// Fetch documents
async function fetchDocuments(type: string = 'wiki'): Promise<WikiDocument[]> {
  const res = await apiGet(`/api/documents?type=${type}`);
  if (!res.ok) {
    throw createApiStatusError('Failed to fetch documents', res.status);
  }
  return res.json();
}

// Create document
async function createDocumentApi(data: { title: string; document_type: string; parent_id?: string | null }): Promise<WikiDocument> {
  const res = await apiPost('/api/documents', data);
  if (!res.ok) {
    throw createApiStatusError('Failed to create document', res.status);
  }
  return res.json();
}

// Update document
async function updateDocumentApi(id: string, updates: Partial<WikiDocument>): Promise<WikiDocument> {
  const res = await apiPatch(`/api/documents/${id}`, updates);
  if (!res.ok) {
    throw createApiStatusError('Failed to update document', res.status);
  }
  return res.json();
}

// Delete document
async function deleteDocumentApi(id: string): Promise<void> {
  const res = await apiDelete(`/api/documents/${id}`);
  if (!res.ok) {
    throw createApiStatusError('Failed to delete document', res.status);
  }
}

// Hook to get documents
export function useDocumentsQuery(type: string = 'wiki') {
  const queryKey = type === 'wiki' ? documentKeys.wikiList() : documentKeys.list(type);
  return useQuery({
    queryKey,
    queryFn: () => fetchDocuments(type),
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
}

// Hook to create document with optimistic update
export function useCreateDocument() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: { title?: string; document_type?: string; parent_id?: string | null; visibility?: 'private' | 'workspace' }) =>
      createDocumentApi({
        title: data.title ?? 'Untitled',
        document_type: data.document_type ?? 'wiki',
        parent_id: data.parent_id ?? null,
      }),
    onMutate: async (newDoc) => {
      await queryClient.cancelQueries({ queryKey: documentKeys.lists() });
      const previousDocs = queryClient.getQueryData<WikiDocument[]>(documentKeys.wikiList());

      const optimisticDoc: WikiDocument = {
        id: `temp-${crypto.randomUUID()}`,
        title: newDoc.title ?? 'Untitled',
        document_type: newDoc.document_type ?? 'wiki',
        parent_id: newDoc.parent_id ?? null,
        position: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        visibility: newDoc.visibility ?? 'workspace',
      };

      queryClient.setQueryData<WikiDocument[]>(
        documentKeys.wikiList(),
        (old) => [optimisticDoc, ...(old || [])]
      );

      return { previousDocs, optimisticId: optimisticDoc.id };
    },
    onError: (_err, _newDoc, context) => {
      if (context?.previousDocs) {
        queryClient.setQueryData(documentKeys.wikiList(), context.previousDocs);
      }
    },
    onSuccess: (data, _variables, context) => {
      if (context?.optimisticId) {
        queryClient.setQueryData<WikiDocument[]>(
          documentKeys.wikiList(),
          (old) => old?.map(d => d.id === context.optimisticId ? data : d) || [data]
        );
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: documentKeys.lists() });
    },
  });
}

// Hook to update document with optimistic update
export function useUpdateDocument() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, updates }: { id: string; updates: Partial<WikiDocument> }) =>
      updateDocumentApi(id, updates),
    onMutate: async ({ id, updates }) => {
      await queryClient.cancelQueries({ queryKey: documentKeys.lists() });
      const previousDocs = queryClient.getQueryData<WikiDocument[]>(documentKeys.wikiList());

      queryClient.setQueryData<WikiDocument[]>(
        documentKeys.wikiList(),
        (old) => old?.map(d => d.id === id ? { ...d, ...updates } : d) || []
      );

      return { previousDocs };
    },
    onError: (_err, _variables, context) => {
      if (context?.previousDocs) {
        queryClient.setQueryData(documentKeys.wikiList(), context.previousDocs);
      }
    },
    onSuccess: (data, { id }) => {
      queryClient.setQueryData<WikiDocument[]>(
        documentKeys.wikiList(),
        (old) => old?.map(d => d.id === id ? data : d) || []
      );
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: documentKeys.lists() });
    },
  });
}

// Hook to delete document with optimistic update
export function useDeleteDocument() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => deleteDocumentApi(id),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: documentKeys.lists() });
      const previousDocs = queryClient.getQueryData<WikiDocument[]>(documentKeys.wikiList());

      queryClient.setQueryData<WikiDocument[]>(
        documentKeys.wikiList(),
        (old) => old?.filter(d => d.id !== id) || []
      );

      return { previousDocs };
    },
    onError: (_err, _id, context) => {
      if (context?.previousDocs) {
        queryClient.setQueryData(documentKeys.wikiList(), context.previousDocs);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: documentKeys.lists() });
    },
  });
}

// Compatibility hook that matches the old useDocuments interface
export function useDocuments() {
  const { data: documents = [], isLoading: loading, refetch } = useDocumentsQuery('wiki');
  const createMutation = useCreateDocument();
  const updateMutation = useUpdateDocument();
  const deleteMutation = useDeleteDocument();

  const createDocument = async (parentId?: string): Promise<WikiDocument | null> => {
    try {
      return await createMutation.mutateAsync({ parent_id: parentId });
    } catch {
      return null;
    }
  };

  const updateDocument = async (id: string, updates: Partial<WikiDocument>): Promise<WikiDocument | null> => {
    try {
      return await updateMutation.mutateAsync({ id, updates });
    } catch {
      return null;
    }
  };

  const deleteDocument = async (id: string): Promise<boolean> => {
    try {
      await deleteMutation.mutateAsync(id);
      return true;
    } catch {
      return false;
    }
  };

  const refreshDocuments = async (): Promise<void> => {
    await refetch();
  };

  return {
    documents,
    loading,
    createDocument,
    updateDocument,
    deleteDocument,
    refreshDocuments,
  };
}
