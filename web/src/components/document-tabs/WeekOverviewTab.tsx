import { useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { UnifiedEditor } from '@/components/UnifiedEditor';
import type { UnifiedDocument, SidebarData } from '@/components/UnifiedEditor';
import { useAuth } from '@/hooks/useAuth';
import { useAssignableMembersQuery } from '@/hooks/useTeamMembersQuery';
import { useActiveWeeksQuery } from '@/hooks/useWeeksQuery';
import { apiPatch, apiDelete } from '@/lib/api';
import type { DocumentTabProps } from '@/lib/document-tabs';

/**
 * SprintOverviewTab - Renders the sprint document in the UnifiedEditor
 *
 * This is the "Overview" tab content when viewing a sprint document.
 * Shows the sprint plan and description.
 */
export default function SprintOverviewTab({ documentId, document }: DocumentTabProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();

  // Fetch team members for owner selection
  const { data: teamMembersData = [] } = useAssignableMembersQuery();
  const people = useMemo(() => teamMembersData.map(m => ({
    id: m.id,
    user_id: m.user_id,
    name: m.name,
  })), [teamMembersData]);

  // Fetch active sprints for availability calculation
  const { data: activeSprintsData } = useActiveWeeksQuery();
  const existingSprints = useMemo(() =>
    (activeSprintsData?.weeks ?? []).map(s => ({ owner: s.owner })),
    [activeSprintsData]
  );

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
      await queryClient.cancelQueries({ queryKey: ['sprints'] });

      // Snapshot the previous value
      const previousDocument = queryClient.getQueryData<Record<string, unknown>>(['document', documentId]);

      // Optimistically update the document cache
      if (previousDocument) {
        const sprintUpdates = updates as Record<string, unknown>;
        queryClient.setQueryData(['document', documentId], { ...previousDocument, ...sprintUpdates });
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
      queryClient.invalidateQueries({ queryKey: ['sprints'] });
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
      navigate('/team/allocation');
    },
  });

  // Handle back navigation
  const handleBack = useCallback(() => {
    navigate('/team/allocation');
  }, [navigate]);

  // Handle update
  const handleUpdate = useCallback(async (updates: Partial<UnifiedDocument>) => {
    await updateMutation.mutateAsync(updates);
  }, [updateMutation]);

  // Handle delete
  const handleDelete = useCallback(async () => {
    if (!window.confirm('Are you sure you want to delete this week?')) return;
    await deleteMutation.mutateAsync();
  }, [deleteMutation]);

  // Build sidebar data with people and existing sprints for owner selection
  const sidebarData: SidebarData = useMemo(() => ({
    people,
    existingSprints,
  }), [people, existingSprints]);

  // Get program_id from belongs_to array (sprint's parent program via document_associations)
  const belongsTo = (document as { belongs_to?: Array<{ id: string; type: string }> }).belongs_to;
  const programId = belongsTo?.find(b => b.type === 'program')?.id;

  // Transform to UnifiedDocument format
  const unifiedDocument: UnifiedDocument = useMemo(() => ({
    id: document.id,
    title: document.title,
    document_type: 'sprint',
    created_at: document.created_at,
    updated_at: document.updated_at,
    created_by: document.created_by as string | undefined,
    properties: document.properties,
    start_date: (document.start_date as string) || '',
    end_date: (document.end_date as string) || '',
    status: ((document.status as string) || 'planning') as 'planning' | 'active' | 'completed',
    program_id: programId,
    plan: (document.plan as string) || '',
    owner_id: document.owner_id,
  }), [document, programId]);

  if (!user) return null;

  return (
    <UnifiedEditor
      document={unifiedDocument}
      sidebarData={sidebarData}
      onUpdate={handleUpdate}
      onBack={handleBack}
      backLabel="weeks"
      onDelete={handleDelete}
      showTypeSelector={false}
    />
  );
}
