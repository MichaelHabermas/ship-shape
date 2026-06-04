// UnifiedEditor adapts document editing, sidebars, banners, and collaboration per document type.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Editor } from '@/components/Editor';
import { PropertiesPanel } from '@/components/sidebars/PropertiesPanel';
import { WeeklyReviewSubNav } from '@/components/review/WeeklyReviewSubNav';
import { useWeeklyReviewActions } from '@/hooks/useWeeklyReviewActions';
import type { PanelDocument } from '@/components/sidebars/PropertiesPanel';
import { DocumentTypeSelector, getMissingRequiredFields } from '@/components/sidebars/DocumentTypeSelector';
import type { SelectableDocumentType, ConversionDocumentType,
  EditorDocumentType,
  UnifiedDocumentView,
  IssueDocumentView,
  ProjectDocumentView,
  SprintDocumentView } from '@ship/shared';
import { useAuth } from '@/hooks/useAuth';
import { PlanQualityBanner, RetroQualityBanner } from '@/components/PlanQualityBanner';
import { ResilientSection } from '@/components/ui/ResilientSection';
import { useAutoSave } from '@/hooks/useAutoSave';
import type { Person } from '@/components/PersonCombobox';

// Sidebar data types
interface WikiSidebarData {
  teamMembers: Person[];
}

interface IssueSidebarData {
  teamMembers: Array<{ id: string; user_id: string; name: string }>;
  programs: Array<{ id: string; name: string; color?: string }>;
  projects?: Array<{ id: string; title: string; color?: string }>;
  onConvert?: () => void;
  onUndoConversion?: () => void;
  onAccept?: () => Promise<void>;
  onReject?: (reason: string) => Promise<void>;
  isConverting?: boolean;
  isUndoing?: boolean;
  onAssociationChange?: () => void;
}

interface ProjectSidebarData {
  programs: Array<{ id: string; name: string; emoji?: string | null }>;
  people: Person[];
  onConvert?: () => void;
  onUndoConversion?: () => void;
  isConverting?: boolean;
  isUndoing?: boolean;
}

interface SprintSidebarData {
  people?: Array<{ id: string; user_id: string; name: string }>;
  existingSprints?: Array<{ owner?: { id: string; name: string; email?: string } | null }>;
}

interface ProgramSidebarData {
  people: Array<{ id: string; user_id: string; name: string; email: string }>;
}

export type SidebarData = WikiSidebarData | IssueSidebarData | ProjectSidebarData | SprintSidebarData | ProgramSidebarData;

interface UnifiedEditorProps {
  /** The document to edit */
  document: UnifiedDocumentView;
  /** Type-specific sidebar data */
  sidebarData?: SidebarData;
  /** Handler for document updates */
  onUpdate: (updates: Partial<UnifiedDocumentView>) => Promise<void>;
  /** Handler for back navigation */
  onBack?: () => void;
  /** Label for back button */
  backLabel?: string;
  /** Handler for document deletion */
  onDelete?: () => void;
  /** Room prefix for collaboration */
  roomPrefix?: string;
  /** Placeholder text for empty editor */
  placeholder?: string;
  /** Handler for creating sub-documents */
  onCreateSubDocument?: () => Promise<{ id: string; title: string } | null>;
  /** Handler for navigating to documents */
  onNavigateToDocument?: (docId: string) => void;
  /** Handler for document conversion events */
  onDocumentConverted?: (newDocId: string, newDocType: ConversionDocumentType) => void;
  /** Badge to show in header */
  headerBadge?: React.ReactNode;
  /** Whether to show the document type selector */
  showTypeSelector?: boolean;
  /** Handler for document type changes (if different from onUpdate) */
  onTypeChange?: (newType: SelectableDocumentType) => Promise<void>;
  /** Suffix displayed after the title in the header (e.g., author name) */
  titleSuffix?: string;
}

/**
 * UnifiedEditor - Adaptive editor component that renders type-specific properties
 *
 * This component provides a unified editing experience for all document types
 * by adapting the properties sidebar based on document_type while using the
 * same TipTap editor for content.
 *
 * Usage:
 * ```tsx
 * <UnifiedEditor
 *   document={myDocument}
 *   sidebarData={typeSpecificData}
 *   onUpdate={handleUpdate}
 *   onBack={() => navigate(-1)}
 * />
 * ```
 */
export function UnifiedEditor({
  document,
  sidebarData = {},
  onUpdate,
  onBack,
  backLabel,
  onDelete,
  roomPrefix,
  placeholder,
  onCreateSubDocument,
  onNavigateToDocument,
  onDocumentConverted,
  headerBadge,
  showTypeSelector = false,
  onTypeChange,
  titleSuffix,
}: UnifiedEditorProps) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [isChangingType, setIsChangingType] = useState(false);

  // Track missing required fields after type changes
  const missingFields = useMemo(() => {
    const selectableType = document.document_type as SelectableDocumentType;
    if (['wiki', 'issue', 'project', 'sprint'].includes(selectableType)) {
      // Build properties object from document
      const props: Record<string, unknown> = {
        ...document.properties,
        // Include top-level fields that might be required
        state: (document as IssueDocumentView).state,
        priority: (document as IssueDocumentView).priority,
        impact: (document as ProjectDocumentView).impact,
        confidence: (document as ProjectDocumentView).confidence,
        ease: (document as ProjectDocumentView).ease,
        start_date: (document as SprintDocumentView).start_date,
        end_date: (document as SprintDocumentView).end_date,
        status: (document as SprintDocumentView).status,
      };
      return getMissingRequiredFields(selectableType, props);
    }
    return [];
  }, [document]);

  // Auto-save title changes
  const throttledTitleSave = useAutoSave({
    onSave: async (title: string) => {
      if (title) await onUpdate({ title });
    },
  });

  // Handle document type change
  const handleTypeChange = useCallback(async (newType: SelectableDocumentType) => {
    if (newType === document.document_type) return;

    setIsChangingType(true);
    try {
      if (onTypeChange) {
        await onTypeChange(newType);
      } else {
        await onUpdate({ document_type: newType });
      }
    } finally {
      setIsChangingType(false);
    }
  }, [document.document_type, onTypeChange, onUpdate]);

  // Navigate to document handler
  const handleNavigateToDocument = useCallback((docId: string) => {
    if (onNavigateToDocument) {
      onNavigateToDocument(docId);
    } else {
      navigate(`/documents/${docId}`);
    }
  }, [navigate, onNavigateToDocument]);

  // Handle plan change (for sprint and project documents)
  const handlePlanChange = useCallback(async (plan: string) => {
    if (document.document_type !== 'sprint' && document.document_type !== 'project') return;
    // Update the plan property
    await onUpdate({ plan });
  }, [document.document_type, onUpdate]);

  // Determine room prefix based on document type if not provided
  const effectiveRoomPrefix = roomPrefix || document.document_type;

  // Determine placeholder based on document type if not provided
  const effectivePlaceholder = placeholder || getDefaultPlaceholder(document.document_type);

  // Weekly plans and retros have review-mode sub-nav controls
  const isWeeklyDoc = document.document_type === 'weekly_plan' || document.document_type === 'weekly_retro';

  const weeklyReviewState = useWeeklyReviewActions(
    isWeeklyDoc
      ? {
          id: document.id,
          document_type: document.document_type as 'weekly_plan' | 'weekly_retro',
          properties: document.properties as { person_id?: string; project_id?: string; week_number?: number } | undefined,
        }
      : null
  );

  // Check if this document type can have its type changed
  const canChangeType = ['wiki', 'issue', 'project', 'sprint'].includes(document.document_type);

  // Build panel-specific props from sidebarData
  const panelProps = useMemo(() => {
    switch (document.document_type) {
      case 'wiki': {
        const wikiData = sidebarData as WikiSidebarData;
        return {
          teamMembers: wikiData.teamMembers || [],
          currentUserId: user?.id,
        };
      }
      case 'issue': {
        const issueData = sidebarData as IssueSidebarData;
        return {
          teamMembers: issueData.teamMembers || [],
          programs: issueData.programs || [],
          projects: issueData.projects || [],
          onConvert: issueData.onConvert,
          onUndoConversion: issueData.onUndoConversion,
          onAccept: issueData.onAccept,
          onReject: issueData.onReject,
          isConverting: issueData.isConverting,
          isUndoing: issueData.isUndoing,
          onAssociationChange: issueData.onAssociationChange,
        };
      }
      case 'project': {
        const projectData = sidebarData as ProjectSidebarData;
        return {
          programs: projectData.programs || [],
          people: projectData.people || [],
          onConvert: projectData.onConvert,
          onUndoConversion: projectData.onUndoConversion,
          isConverting: projectData.isConverting,
          isUndoing: projectData.isUndoing,
        };
      }
      case 'sprint': {
        const sprintData = sidebarData as SprintSidebarData;
        return {
          people: sprintData.people || [],
          existingSprints: sprintData.existingSprints || [],
        };
      }
      case 'program': {
        const programData = sidebarData as ProgramSidebarData;
        return {
          people: programData.people || [],
        };
      }
      default:
        return {};
    }
  }, [document.document_type, sidebarData, user?.id]);

  // Render the type-specific sidebar content via unified PropertiesPanel
  const typeSpecificSidebar = useMemo(() => {
    // Check if document type has a properties panel
    if (!['wiki', 'issue', 'project', 'sprint', 'program', 'weekly_plan', 'weekly_retro'].includes(document.document_type)) {
      return (
        <div className="p-4">
          <p className="text-xs text-muted">
            Document type: {document.document_type}
          </p>
        </div>
      );
    }

    return (
      <PropertiesPanel
        document={document as PanelDocument}
        panelProps={panelProps}
        onUpdate={onUpdate}
        highlightedFields={missingFields}
        weeklyReviewState={weeklyReviewState}
      />
    );
  }, [document, panelProps, onUpdate, missingFields, weeklyReviewState]);

  // Compose full sidebar with type selector
  const sidebar = useMemo(() => {
    // If we're not showing the type selector, just return the type-specific sidebar
    if (!showTypeSelector || !canChangeType) {
      return typeSpecificSidebar;
    }

    // Add type selector at the top
    return (
      <div className="flex flex-col h-full">
        {/* Type Selector */}
        <div className="p-4 border-b border-border">
          <DocumentTypeSelector
            value={document.document_type as SelectableDocumentType}
            onChange={handleTypeChange}
            disabled={isChangingType}
          />
          {missingFields.length > 0 && (
            <p className="mt-2 text-xs text-amber-500">
              Please fill in required fields: {missingFields.join(', ')}
            </p>
          )}
        </div>
        {/* Type-specific sidebar */}
        <div className="flex-1 overflow-auto pb-20">
          {typeSpecificSidebar}
        </div>
      </div>
    );
  }, [showTypeSelector, canChangeType, typeSpecificSidebar, document.document_type, handleTypeChange, isChangingType, missingFields]);

  if (!user) {
    return null;
  }

  // Weekly plans and retros have computed titles (includes person name) - make read-only
  const isTitleReadOnly = document.document_type === 'weekly_plan' || document.document_type === 'weekly_retro';

  // AI quality banner — triggers analysis on content changes from the editor
  const [editorContent, setEditorContent] = useState<Record<string, unknown> | null>(null);
  const [aiScoringAnalysis, setAiScoringAnalysis] = useState<{ planAnalysis?: unknown; retroAnalysis?: unknown } | null>(null);

  // Prevent stale AI feedback from leaking when navigating to a different document.
  useEffect(() => {
    setEditorContent(null);
    setAiScoringAnalysis(null);
  }, [document.id]);

  const handlePlanAnalysisChange = useCallback((analysis: unknown) => {
    setAiScoringAnalysis(analysis ? { planAnalysis: analysis } : null);
  }, []);

  const handleRetroAnalysisChange = useCallback((analysis: unknown) => {
    setAiScoringAnalysis(analysis ? { retroAnalysis: analysis } : null);
  }, []);

  const contentBanner = useMemo(() => {
    if (document.document_type === 'weekly_plan') {
      return (
        <ResilientSection
          name="plan-quality-banner"
          fallbackTitle="AI quality check unavailable"
          fallbackDescription="Your plan content is still available while this optional check recovers."
          resetKeys={[document.id, document.document_type]}
        >
          <PlanQualityBanner documentId={document.id} editorContent={editorContent} onAnalysisChange={handlePlanAnalysisChange} />
        </ResilientSection>
      );
    }
    if (document.document_type === 'weekly_retro') {
      return (
        <ResilientSection
          name="retro-quality-banner"
          fallbackTitle="AI quality check unavailable"
          fallbackDescription="Your retro content is still available while this optional check recovers."
          resetKeys={[document.id, document.document_type]}
        >
          <RetroQualityBanner documentId={document.id} editorContent={editorContent} planContent={null} onAnalysisChange={handleRetroAnalysisChange} />
        </ResilientSection>
      );
    }
    return undefined;
  }, [document.id, document.document_type, editorContent, handlePlanAnalysisChange, handleRetroAnalysisChange]);

  const secondaryHeader = useMemo(() => {
    if (!weeklyReviewState?.isReviewMode) return undefined;
    return <WeeklyReviewSubNav reviewState={weeklyReviewState} />;
  }, [weeklyReviewState]);

  return (
    <Editor
      documentId={document.id}
      userName={user.name}
      initialTitle={document.title}
      onTitleChange={isTitleReadOnly ? undefined : throttledTitleSave}
      titleReadOnly={isTitleReadOnly}
      onBack={onBack}
      backLabel={backLabel}
      onDelete={onDelete}
      roomPrefix={effectiveRoomPrefix}
      placeholder={effectivePlaceholder}
      onCreateSubDocument={onCreateSubDocument}
      onNavigateToDocument={handleNavigateToDocument}
      onDocumentConverted={onDocumentConverted}
      headerBadge={headerBadge}
      secondaryHeader={secondaryHeader}
      sidebar={sidebar}
      documentType={document.document_type}
      onPlanChange={document.document_type === 'sprint' || document.document_type === 'project' ? handlePlanChange : undefined}
      contentBanner={contentBanner}
      onContentChange={isWeeklyDoc ? setEditorContent : undefined}
      aiScoringAnalysis={isWeeklyDoc ? aiScoringAnalysis : undefined}
      titleSuffix={titleSuffix}
    />
  );
}

/**
 * Get default placeholder text based on document type
 */
function getDefaultPlaceholder(documentType: EditorDocumentType): string {
  switch (documentType) {
    case 'wiki':
      return 'Start writing...';
    case 'issue':
      return 'Add a description...';
    case 'project':
      return 'Describe this project...';
    case 'sprint':
      return 'Add week goals, notes, or description...';
    case 'program':
      return 'Describe this program...';
    case 'person':
      return 'Add notes about this person...';
    default:
      return 'Start writing...';
  }
}

// Re-export PropertiesPanel as the unified entry point for sidebars
export { PropertiesPanel } from '@/components/sidebars/PropertiesPanel';
