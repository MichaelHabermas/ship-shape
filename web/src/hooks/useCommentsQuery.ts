import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient, assertApiData, assertApiSuccess } from '@/api/client';
import type { components } from '@/api/generated/ship-openapi';

export type Comment = components['schemas']['CommentResponse'];

export function useCommentsQuery(documentId: string | undefined) {
  return useQuery<Comment[]>({
    queryKey: ['comments', documentId],
    queryFn: async () => {
      if (!documentId) {
        throw new Error('Document ID is required to fetch comments');
      }
      const response = await apiClient.GET('/documents/{id}/comments', {
        params: { path: { id: documentId } },
      });
      return assertApiData(response, 'Failed to fetch comments');
    },
    enabled: !!documentId,
  });
}

export function useCreateComment(documentId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: { comment_id: string; content: string; parent_id?: string }) => {
      const response = await apiClient.POST('/documents/{id}/comments', {
        params: { path: { id: documentId } },
        body: data,
      });
      return assertApiData(response, 'Failed to create comment');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['comments', documentId] });
    },
  });
}

export function useUpdateComment(documentId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ commentId, ...data }: { commentId: string; content?: string; resolved_at?: string | null }) => {
      const response = await apiClient.PATCH('/comments/{id}', {
        params: { path: { id: commentId } },
        body: data,
      });
      return assertApiData(response, 'Failed to update comment');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['comments', documentId] });
    },
  });
}

export function useDeleteComment(documentId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (commentId: string) => {
      const response = await apiClient.DELETE('/comments/{id}', {
        params: { path: { id: commentId } },
      });
      return assertApiSuccess(response, 'Failed to delete comment');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['comments', documentId] });
    },
  });
}
