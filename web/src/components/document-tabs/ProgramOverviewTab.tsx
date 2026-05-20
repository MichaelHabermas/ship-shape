import { useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { UnifiedEditor } from '@/components/UnifiedEditor';
import type { UnifiedDocument, SidebarData } from '@/components/UnifiedEditor';
import { useAuth } from '@/hooks/useAuth';
import { useAssignableMembersQuery } from '@/hooks/useTeamMembersQuery';
import { apiPatch, apiDelete } from '@/lib/api';
import type { DocumentTabProps } from '@/lib/document-tabs';

/**
 * ProgramOverviewTab - Renders the program document in the UnifiedEditor
 *
 * This is the "Overview" tab content when viewing a program document.
 */
export default function ProgramOverviewTab({ documentId, document }: DocumentTabProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();

  // Fetch team members for sidebar
  const { data: teamMembersData = [] } = useAssignableMembersQuery();
  const teamMembers = useMemo(() => teamMembersData.map(m => ({
    id: m.id,
    user_id: m.user_id,
    name: m.name,
    email: m.email || '',
  })), [teamMembersData]);

  // Update mutation with optimistic updates
  const updateMutation = useMutation({
    mutationFn: async (updates: Partial<UnifiedDocument>) => {
      const response = await apiPatch(`/api/documents/${documentId}`, updates);
      if (!response.ok) {
        throw new Error('Failed to update document');
      }
      return response.json();
    },
    onMutate: async (updates) => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: ['document', documentId] });
      await queryClient.cancelQueries({ queryKey: ['programs'] });

      // Snapshot the previous value
      const previousDocument = queryClient.getQueryData<Record<string, unknown>>(['document', documentId]);

      // Optimistically update the document cache
      if (previousDocument) {
        const programUpdates = updates as Record<string, unknown>;
        queryClient.setQueryData(['document', documentId], { ...previousDocument, ...programUpdates });
      }

      // Return context with the previous value for rollback
      return { previousDocument };
    },
    onError: (_err, _updates, context) => {
      // Rollback to the previous value on error
      if (context?.previousDocument) {
        queryClient.setQueryData(['document', documentId], context.previousDocument);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['document', documentId] });
      queryClient.invalidateQueries({ queryKey: ['programs'] });
    },
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: async () => {
      const response = await apiDelete(`/api/documents/${documentId}`);
      if (!response.ok) {
        throw new Error('Failed to delete document');
      }
    },
    onSuccess: () => {
      navigate('/programs');
    },
  });

  // Handle back navigation
  const handleBack = useCallback(() => {
    navigate('/programs');
  }, [navigate]);

  // Handle update
  const handleUpdate = useCallback(async (updates: Partial<UnifiedDocument>) => {
    await updateMutation.mutateAsync(updates);
  }, [updateMutation]);

  // Handle delete
  const handleDelete = useCallback(async () => {
    if (!window.confirm('Are you sure you want to delete this program?')) return;
    await deleteMutation.mutateAsync();
  }, [deleteMutation]);

  // Build sidebar data
  const sidebarData: SidebarData = useMemo(() => ({
    people: teamMembers,
  }), [teamMembers]);

  // Transform to UnifiedDocument format
  const unifiedDocument: UnifiedDocument = useMemo(() => ({
    id: document.id,
    title: document.title,
    document_type: 'program',
    created_at: document.created_at,
    updated_at: document.updated_at,
    created_by: document.created_by as string | undefined,
    properties: document.properties,
    color: (document.color as string) || '#6366f1',
    emoji: (document.emoji as string) || null,
    owner_id: document.owner_id as string | undefined,
    // RACI fields
    accountable_id: document.accountable_id as string | undefined,
    consulted_ids: (document.consulted_ids as string[]) || [],
    informed_ids: (document.informed_ids as string[]) || [],
  }), [document]);

  if (!user) return null;

  return (
    <UnifiedEditor
      document={unifiedDocument}
      sidebarData={sidebarData}
      onUpdate={handleUpdate}
      onBack={handleBack}
      backLabel="programs"
      onDelete={handleDelete}
      showTypeSelector={false}
    />
  );
}
