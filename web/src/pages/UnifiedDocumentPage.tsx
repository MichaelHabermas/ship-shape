import { useCallback, useMemo, useEffect, Suspense } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { UnifiedEditor } from '@/components/UnifiedEditor';
import type { UnifiedDocument, SidebarData } from '@/components/UnifiedEditor';
import { useAuth } from '@/hooks/useAuth';
import { useAssignableMembersQuery } from '@/hooks/useTeamMembersQuery';
import { useProgramsQuery } from '@/hooks/useProgramsQuery';
import { useProjectsQuery } from '@/hooks/useProjectsQuery';
import { useDocumentConversion } from '@/hooks/useDocumentConversion';
import { apiGet, apiPatch, apiDelete, apiPost } from '@/lib/api';
import { useToast } from '@/components/ui/Toast';
import { issueKeys } from '@/hooks/useIssuesQuery';
import { projectKeys, useProjectWeeksQuery } from '@/hooks/useProjectsQuery';
import { TabBar } from '@/components/ui/TabBar';
import { useCurrentDocument } from '@/contexts/CurrentDocumentContext';
import {
  getTabsForDocument,
  documentTypeHasTabs,
  resolveTabLabels,
  type DocumentResponse,
  type TabCounts,
} from '@/lib/document-tabs';

/**
 * UnifiedDocumentPage - Renders any document type via /documents/:id route
 *
 * This page fetches a document by ID regardless of type and renders it
 * using the UnifiedEditor component with the appropriate sidebar data.
 * Document types with tabs (projects, programs) get a tabbed interface.
 */
export function UnifiedDocumentPage() {
  const { id, '*': wildcardPath } = useParams<{ id: string; '*'?: string }>();
  const navigate = useNavigate();

  // Parse wildcard path into tab and nested path
  // Example: /documents/abc/sprints/xyz -> wildcardPath = "sprints/xyz" -> tab = "sprints", nestedPath = "xyz"
  const pathSegments = wildcardPath ? wildcardPath.split('/').filter(Boolean) : [];
  const urlTab = pathSegments[0] || undefined;
  const nestedPath = pathSegments.length > 1 ? pathSegments.slice(1).join('/') : undefined;
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { showToast } = useToast();
  const { setCurrentDocument, clearCurrentDocument } = useCurrentDocument();

  // Fetch the document by ID
  const { data: document, isLoading, error } = useQuery<DocumentResponse>({
    queryKey: ['document', id],
    queryFn: async () => {
      const response = await apiGet(`/api/documents/${id}`);
      if (!response.ok) {
        if (response.status === 404) {
          throw new Error('Document not found');
        }
        throw new Error('Failed to fetch document');
      }
      return response.json();
    },
    enabled: !!id,
    retry: false,
  });

  // Sync current document context for rail highlighting
  useEffect(() => {
    if (document && id) {
      const docType = document.document_type as 'wiki' | 'issue' | 'project' | 'program' | 'sprint' | 'person' | 'weekly_plan' | 'weekly_retro' | 'standup';
      // Extract projectId for weekly documents
      const projectId = (document.document_type === 'weekly_plan' || document.document_type === 'weekly_retro')
        ? (document.properties?.project_id as string | undefined) ?? null
        : null;
      setCurrentDocument(id, docType, projectId);
    }
    return () => {
      clearCurrentDocument();
    };
  }, [document, id, setCurrentDocument, clearCurrentDocument]);



  // Set default active tab when document loads (status-aware for sprints)
  const tabConfig = document ? getTabsForDocument(document) : [];
  const hasTabs = document ? documentTypeHasTabs(document.document_type) : false;

  // Derive activeTab from URL - if valid tab in URL, use it; otherwise default to first tab
  const activeTab = useMemo(() => {
    if (urlTab && tabConfig.some(t => t.id === urlTab)) {
      return urlTab;
    }
    return tabConfig[0]?.id || '';
  }, [urlTab, tabConfig]);

  // Redirect to clean URL if tab is invalid (prevents broken bookmarks and typos)
  useEffect(() => {
    if (!document || !id) return;

    // If URL has a tab but it's not valid for this document type, redirect to base URL
    const isValidTab = tabConfig.some(t => t.id === urlTab);
    if (urlTab && !isValidTab) {
      console.warn(`Invalid tab "${urlTab}" for document type "${document.document_type}", redirecting to base URL`);
      navigate(`/documents/${id}`, { replace: true });
    }
  }, [document, id, urlTab, tabConfig, navigate]);

  // Fetch team members for sidebar data
  const { data: teamMembersData = [] } = useAssignableMembersQuery();
  const teamMembers = useMemo(() => teamMembersData.map(m => ({
    id: m.id,
    user_id: m.user_id,
    name: m.name,
    email: m.email || '',
  })), [teamMembersData]);

  // Fetch programs for sidebar data
  const { data: programsData = [] } = useProgramsQuery();
  const programs = useMemo(() => programsData.map(p => ({
    id: p.id,
    name: p.name,
    color: p.color,
    emoji: p.emoji,
  })), [programsData]);

  // Fetch projects for issue sidebar (multi-association)
  const { data: projectsData = [] } = useProjectsQuery();
  const projects = useMemo(() => projectsData.map(p => ({
    id: p.id,
    title: p.title,
    color: p.color,
  })), [projectsData]);

  // Fetch counts for tabs (project weeks, etc.)
  const isProject = document?.document_type === 'project';
  const isProgram = document?.document_type === 'program';
  const { data: projectWeeks = [] } = useProjectWeeksQuery(isProject ? id : undefined);

  // Compute tab counts based on document type
  const tabCounts: TabCounts = useMemo(() => {
    if (isProject) {
      const issueCount = (document as { issue_count?: number })?.issue_count ?? 0;
      return {
        issues: issueCount,
        weeks: projectWeeks.length,
      };
    }
    if (isProgram) {
      // For programs, counts will be loaded by the tab components themselves
      return {};
    }
    return {};
  }, [document, isProject, isProgram, projectWeeks.length]);

  // Handler for when associations change (invalidate document query to refetch)
  const handleAssociationChange = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['document', id] });
  }, [queryClient, id]);

  // Document conversion (issue <-> project)
  const { convert, isConverting } = useDocumentConversion({
    navigateAfterConvert: true,
  });

  // Conversion callbacks that use the current document
  const handleConvert = useCallback(() => {
    if (!document || !id) return;
    const sourceType = document.document_type as 'issue' | 'project';
    convert(id, sourceType, document.title);
  }, [convert, document, id]);

  const handleUndoConversion = useCallback(async () => {
    if (!document || !id) return;

    try {
      const res = await apiPost(`/api/documents/${id}/undo-conversion`, {});

      if (res.ok) {
        // Invalidate caches to refresh the UI
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: issueKeys.lists() }),
          queryClient.invalidateQueries({ queryKey: projectKeys.lists() }),
          queryClient.invalidateQueries({ queryKey: ['document', id] }),
        ]);
        showToast('Conversion undone successfully', 'success');
      } else {
        const error = await res.json();
        showToast(error.error || 'Failed to undo conversion', 'error');
      }
    } catch {
      showToast('Failed to undo conversion', 'error');
    }
  }, [document, id, queryClient, showToast]);

  // Handle document type change via DocumentTypeSelector
  const handleTypeChange = useCallback(async (newType: string) => {
    if (!document || !id) return;

    const currentType = document.document_type;

    // Only issue <-> project conversions are supported
    const isValidConversion =
      (currentType === 'issue' && newType === 'project') ||
      (currentType === 'project' && newType === 'issue');

    if (!isValidConversion) {
      showToast(`Converting ${currentType} to ${newType} is not supported`, 'error');
      return;
    }

    try {
      const res = await apiPost(`/api/documents/${id}/convert`, { target_type: newType });

      if (res.ok) {
        const data = await res.json();

        // Invalidate caches
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: issueKeys.lists() }),
          queryClient.invalidateQueries({ queryKey: projectKeys.lists() }),
          queryClient.invalidateQueries({ queryKey: ['document', id] }),
        ]);

        // Navigate to the new document
        navigate(`/documents/${data.id}`, { replace: true });
      } else {
        const error = await res.json();
        showToast(error.error || 'Failed to convert document', 'error');
      }
    } catch {
      showToast('Failed to convert document', 'error');
    }
  }, [document, id, navigate, queryClient, showToast]);

  // Handle WebSocket notification that document was converted
  const handleDocumentConverted = useCallback((newDocId: string) => {
    navigate(`/documents/${newDocId}`, { replace: true });
  }, [navigate]);

  // Update mutation with optimistic updates
  const updateMutation = useMutation({
    mutationFn: async ({ documentId, updates }: { documentId: string; updates: Partial<DocumentResponse> }) => {
      const response = await apiPatch(`/api/documents/${documentId}`, updates);
      if (!response.ok) {
        throw new Error('Failed to update document');
      }
      return response.json();
    },
    onMutate: async ({ documentId, updates }) => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: ['document', documentId] });

      // Snapshot the previous value
      const previousDocument = queryClient.getQueryData<Record<string, unknown>>(['document', documentId]);

      // Optimistically update the document cache
      if (previousDocument) {
        queryClient.setQueryData(['document', documentId], { ...previousDocument, ...updates });
      }

      // Return context with the previous value for rollback
      return { previousDocument, documentId };
    },
    onError: (_err, _variables, context) => {
      // Rollback to the previous value on error
      if (context?.previousDocument && context?.documentId) {
        queryClient.setQueryData(['document', context.documentId], context.previousDocument);
      }
    },
    onSuccess: (_, { documentId }) => {
      queryClient.invalidateQueries({ queryKey: ['document', documentId] });
      // Also invalidate type-specific queries for list views
      if (document?.document_type) {
        queryClient.invalidateQueries({ queryKey: [document.document_type + 's', 'list'] });
        if (document.document_type === 'wiki') {
          queryClient.invalidateQueries({ queryKey: ['documents', 'wiki'] });
        }
      }
    },
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: async (documentId: string) => {
      const response = await apiDelete(`/api/documents/${documentId}`);
      if (!response.ok) {
        throw new Error('Failed to delete document');
      }
    },
    onSuccess: () => {
      navigate('/docs');
    },
  });

  // Handle update
  const handleUpdate = useCallback(async (updates: Partial<UnifiedDocument>) => {
    if (!id) return;
    await updateMutation.mutateAsync({ documentId: id, updates: updates });
  }, [updateMutation, id]);

  // Handle delete
  const handleDelete = useCallback(async () => {
    if (!id) return;
    if (!window.confirm('Are you sure you want to delete this document?')) return;
    await deleteMutation.mutateAsync(id);
  }, [deleteMutation, id]);

  const isWeeklyDoc = document?.document_type === 'weekly_plan' || document?.document_type === 'weekly_retro';
  const isStandup = document?.document_type === 'standup';
  const hideBackButton = isWeeklyDoc || isStandup;

  // Resolve standup author name for title suffix
  const standupAuthorName = useMemo(() => {
    if (!isStandup) return undefined;
    const authorId = document?.properties?.author_id as string | undefined;
    if (!authorId) return undefined;
    return teamMembersData.find(m => m.user_id === authorId)?.name;
  }, [isStandup, document?.properties?.author_id, teamMembersData]);

  // Handle back navigation
  const handleBack = useCallback(() => {
    // Navigate to type-specific list or docs
    if (document?.document_type === 'issue') {
      navigate('/issues');
    } else if (document?.document_type === 'project') {
      navigate('/projects');
    } else if (document?.document_type === 'sprint') {
      navigate('/sprints');
    } else if (document?.document_type === 'program') {
      navigate('/programs');
    } else {
      navigate('/docs');
    }
  }, [document, navigate]);

  // Compute back label based on document type (just the noun - Editor adds "Back to")
  // Weekly plans/retros don't show a back button
  const backLabel = useMemo(() => {
    switch (document?.document_type) {
      case 'issue': return 'issues';
      case 'project': return 'projects';
      case 'sprint': return 'weeks';
      case 'program': return 'programs';
      default: return 'docs';
    }
  }, [document?.document_type]);

  // Build sidebar data based on document type
  const sidebarData: SidebarData = useMemo(() => {
    if (!document) return {};

    switch (document.document_type) {
      case 'wiki':
        return {
          teamMembers,
        };
      case 'issue':
        return {
          teamMembers,
          programs,
          projects,
          onAssociationChange: handleAssociationChange,
          onConvert: handleConvert,
          onUndoConversion: handleUndoConversion,
          isConverting,
          isUndoing: isConverting,
        };
      case 'project':
        return {
          programs,
          people: teamMembers,
          onConvert: handleConvert,
          onUndoConversion: handleUndoConversion,
          isConverting,
          isUndoing: isConverting,
        };
      case 'sprint':
        return {};
      default:
        return {};
    }
  }, [document, teamMembers, programs, projects, handleAssociationChange, handleConvert, handleUndoConversion, isConverting]);

  // Transform API response to UnifiedDocument format
  const unifiedDocument: UnifiedDocument | null = useMemo(() => {
    if (!document) return null;

    // Extract program_id from belongs_to array (via document_associations)
    const belongsTo = document.belongs_to as Array<{ id: string; type: string }> | undefined;
    const programIdFromBelongsTo = belongsTo?.find(b => b.type === 'program')?.id;
    const sprintIdFromBelongsTo = belongsTo?.find(b => b.type === 'sprint')?.id;

    return {
      id: document.id,
      title: document.title,
      document_type: document.document_type as UnifiedDocument['document_type'],
      created_at: document.created_at,
      updated_at: document.updated_at,
      created_by: document.created_by as string | undefined,
      properties: document.properties,
      // Spread flattened properties based on type
      ...(document.document_type === 'issue' && {
        state: (document.state as string) || 'backlog',
        priority: (document.priority as string) || 'medium',
        estimate: document.estimate as number | undefined,
        assignee_id: document.assignee_id as string | undefined,
        assignee_name: document.assignee_name as string | undefined,
        program_id: programIdFromBelongsTo,
        sprint_id: sprintIdFromBelongsTo,
        source: document.source as 'internal' | 'external' | undefined,
        converted_from_id: document.converted_from_id as string | undefined,
        display_id: (document.ticket_number as number) ? `#${document.ticket_number}` : undefined,
        belongs_to: document.belongs_to as Array<{
          id: string;
          type: 'program' | 'project' | 'sprint' | 'parent';
          title?: string;
          color?: string;
        }> | undefined,
      }),
      ...(document.document_type === 'project' && {
        impact: (document.impact as number | null) ?? null,
        confidence: (document.confidence as number | null) ?? null,
        ease: (document.ease as number | null) ?? null,
        color: (document.color) || '#3b82f6',
        emoji: null,
        program_id: programIdFromBelongsTo,
        owner: document.owner as { id: string; name: string; email: string } | null,
        owner_id: document.owner_id as string | undefined,
        // RACI fields
        accountable_id: document.accountable_id as string | undefined,
        consulted_ids: document.consulted_ids as string[] | undefined,
        informed_ids: document.informed_ids as string[] | undefined,
        converted_from_id: document.converted_from_id as string | undefined,
      }),
      ...(document.document_type === 'sprint' && {
        start_date: (document.start_date as string) || '',
        end_date: (document.end_date as string) || '',
        status: ((document.status as string) || 'planning') as 'planning' | 'active' | 'completed',
        program_id: programIdFromBelongsTo,
        plan: (document.plan as string) || '',
      }),
      ...(document.document_type === 'wiki' && {
        parent_id: document.parent_id as string | undefined,
        visibility: document.visibility as 'private' | 'workspace' | undefined,
      }),
    };
  }, [document]);

  // Loading state
  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-muted">Loading...</div>
      </div>
    );
  }

  // Error state
  if (error || !document) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4">
        <div className="text-muted">
          {error?.message || 'Document not found'}
        </div>
        <button
          onClick={() => navigate('/docs')}
          className="text-sm text-accent hover:underline"
        >
          Go to Documents
        </button>
      </div>
    );
  }

  if (!user || !unifiedDocument) {
    return null;
  }

  // Documents with tabs get a tabbed interface
  if (hasTabs && tabConfig.length > 0) {
    const tabs = resolveTabLabels(tabConfig, document, tabCounts);
    const currentTabConfig = tabConfig.find(t => t.id === activeTab) || tabConfig[0];
    const TabComponent = currentTabConfig?.component;

    return (
      <div className="flex h-full flex-col">
        {/* Tab bar */}
        <div className="border-b border-border px-4">
          <TabBar
            tabs={tabs}
            activeTab={activeTab || tabs[0]?.id}
            onTabChange={(tab) => {
              // Navigate to new URL - first tab gets clean URL, others get tab suffix
              if (tab === tabConfig[0]?.id) {
                navigate(`/documents/${id}`);
              } else {
                navigate(`/documents/${id}/${tab}`);
              }
            }}
          />
        </div>

        {/* Content area with lazy-loaded tab component */}
        <div className="flex-1 overflow-hidden">
          <Suspense
            fallback={
              <div className="flex h-full items-center justify-center">
                <div className="text-muted">Loading...</div>
              </div>
            }
          >
            {TabComponent && (
              <TabComponent documentId={id!} document={document} nestedPath={nestedPath} />
            )}
          </Suspense>
        </div>
      </div>
    );
  }

  // Non-tabbed documents render directly in editor
  return (
    <UnifiedEditor
      document={unifiedDocument}
      sidebarData={sidebarData}
      onUpdate={handleUpdate}
      onTypeChange={handleTypeChange}
      onDocumentConverted={handleDocumentConverted}
      onBack={hideBackButton ? undefined : handleBack}
      backLabel={hideBackButton ? undefined : backLabel}
      onDelete={handleDelete}
      showTypeSelector={true}
      titleSuffix={standupAuthorName}
    />
  );
}
