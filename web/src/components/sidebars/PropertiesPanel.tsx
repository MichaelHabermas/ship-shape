/**
 * PropertiesPanel - Unified sidebar component that renders type-specific properties
 *
 * This component consolidates the 4 type-specific sidebars into a single entry point.
 * It adapts based on document_type while maintaining the same rendering patterns.
 */
import { useMemo, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { WikiSidebar } from '@/components/sidebars/WikiSidebar';
import { IssueSidebar } from '@/components/sidebars/IssueSidebar';
import { ProjectSidebar } from '@/components/sidebars/ProjectSidebar';
import { WeekSidebar } from '@/components/sidebars/WeekSidebar';
import { ProgramSidebar } from '@/components/sidebars/ProgramSidebar';
import { ContentHistoryPanel } from '@/components/ContentHistoryPanel';
import { RetroQualityAssistant } from '@/components/sidebars/QualityAssistant';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useAuth } from '@/hooks/useAuth';
import { apiGet } from '@/lib/api';
import { cn } from '@/lib/cn';
import type { WeeklyReviewActionsState } from '@/hooks/useWeeklyReviewActions';
import type { Person } from '@/components/PersonCombobox';
import type { BelongsTo, ApprovalTracking } from '@ship/shared';

// Document types that have properties panels
export type PanelDocumentType = 'wiki' | 'issue' | 'project' | 'sprint' | 'program' | 'weekly_plan' | 'weekly_retro';

// Base document interface
interface BaseDocument {
  id: string;
  title: string;
  document_type: string;
  created_at?: string;
  updated_at?: string;
  created_by?: string | null;
  properties?: Record<string, unknown>;
}

// Wiki document properties
interface WikiDocument extends BaseDocument {
  document_type: 'wiki';
  parent_id?: string | null;
  visibility?: 'private' | 'workspace';
}

// Issue document properties
interface IssueDocument extends BaseDocument {
  document_type: 'issue';
  state: string;
  priority: string;
  estimate: number | null;
  assignee_id: string | null;
  assignee_name?: string | null;
  assignee_archived?: boolean;
  program_id: string | null;
  sprint_id: string | null;
  source?: 'internal' | 'external';
  rejection_reason?: string | null;
  converted_from_id?: string | null;
  belongs_to?: BelongsTo[];
}

// Project document properties
interface ProjectDocument extends BaseDocument {
  document_type: 'project';
  impact: number | null;
  confidence: number | null;
  ease: number | null;
  ice_score?: number | null;
  color: string;
  emoji: string | null;
  program_id: string | null;
  owner?: { id: string; name: string; email: string } | null;
  owner_id?: string | null;
  // RACI fields
  accountable_id?: string | null;
  consulted_ids?: string[];
  informed_ids?: string[];
  sprint_count?: number;
  issue_count?: number;
  converted_from_id?: string | null;
  // Approval tracking
  plan?: string | null;
  plan_approval?: ApprovalTracking | null;
  retro_approval?: ApprovalTracking | null;
  has_retro?: boolean;
}

// Sprint document properties
interface SprintDocument extends BaseDocument {
  document_type: 'sprint';
  status: 'planning' | 'active' | 'completed';
  program_id: string | null;
  program_name?: string;
  program_accountable_id?: string | null;
  owner_reports_to?: string | null;
  issue_count?: number;
  completed_count?: number;
  plan?: string;
  owner?: { id: string; name: string; email: string } | null;
  owner_id?: string | null;
  // Approval tracking
  plan_approval?: ApprovalTracking | null;
  review_approval?: ApprovalTracking | null;
  accountable_id?: string | null;
  has_review?: boolean;
}

// Program document properties
interface ProgramDocument extends BaseDocument {
  document_type: 'program';
  color?: string;
  emoji?: string | null;
  owner_id?: string | null;
  // RACI fields
  accountable_id?: string | null;
  consulted_ids?: string[];
  informed_ids?: string[];
}

// Weekly plan document properties
interface WeeklyPlanDocument extends BaseDocument {
  document_type: 'weekly_plan';
  properties?: {
    person_id?: string;
    project_id?: string;
    week_number?: number;
    submitted_at?: string | null;
  };
}

// Weekly retro document properties
interface WeeklyRetroDocument extends BaseDocument {
  document_type: 'weekly_retro';
  properties?: {
    person_id?: string;
    project_id?: string;
    week_number?: number;
    submitted_at?: string | null;
  };
}

// Union type for all documents
export type PanelDocument = WikiDocument | IssueDocument | ProjectDocument | SprintDocument | ProgramDocument | WeeklyPlanDocument | WeeklyRetroDocument;

// Props for wiki panel
interface WikiPanelProps {
  teamMembers: Person[];
  currentUserId?: string;
}

// Props for issue panel
interface IssuePanelProps {
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

// Props for project panel
interface ProjectPanelProps {
  programs: Array<{ id: string; name: string; color: string; emoji?: string | null }>;
  people: Person[];
  onConvert?: () => void;
  onUndoConversion?: () => void;
  isConverting?: boolean;
  isUndoing?: boolean;
  /** Whether current user can approve (is accountable or workspace admin) */
  canApprove?: boolean;
  /** Map of user ID to name for displaying approver */
  userNames?: Record<string, string>;
  /** Callback when approval state changes */
  onApprovalUpdate?: () => void;
}

// Props for sprint panel
interface SprintPanelProps {
  people?: Array<{ id: string; user_id: string; name: string }>;
  existingSprints?: Array<{ owner?: { id: string; name: string; email: string } | null }>;
  /** Whether current user can approve (is accountable or workspace admin) */
  canApprove?: boolean;
  /** Map of user ID to name for displaying approver */
  userNames?: Record<string, string>;
  /** Callback when approval state changes */
  onApprovalUpdate?: () => void;
}

// Props for program panel
interface ProgramPanelProps {
  people: Person[];
}

// Combined props type that includes all panel-specific props
type PanelSpecificProps = WikiPanelProps | IssuePanelProps | ProjectPanelProps | SprintPanelProps | ProgramPanelProps;

interface PropertiesPanelProps {
  /** The document to render properties for */
  document: PanelDocument;
  /** Type-specific data required for rendering */
  panelProps: PanelSpecificProps;
  /** Handler for document updates */
  onUpdate: (updates: Partial<PanelDocument>) => Promise<void>;
  /** Fields to highlight as missing (e.g., after type conversion) */
  highlightedFields?: string[];
  /** Shared weekly review state used by sub-nav and sidebar */
  weeklyReviewState?: WeeklyReviewActionsState | null;
}

// OPM 5-level performance rating scale
const OPM_RATINGS = [
  { value: 5, label: 'Outstanding', color: 'text-green-500' },
  { value: 4, label: 'Exceeds Expectations', color: 'text-blue-500' },
  { value: 3, label: 'Fully Successful', color: 'text-muted' },
  { value: 2, label: 'Minimally Satisfactory', color: 'text-orange-500' },
  { value: 1, label: 'Unacceptable', color: 'text-red-500' },
] as const;

/**
 * WeeklyDocumentSidebar - Renders sidebar for weekly_plan/weekly_retro documents
 * with human-readable names instead of UUIDs.
 * In review mode (?review=true&sprintId=X), actions move to the sub-nav.
 */
function WeeklyDocumentSidebar({
  document,
  weeklyReviewState,
}: {
  document: WeeklyPlanDocument | WeeklyRetroDocument;
  weeklyReviewState?: WeeklyReviewActionsState | null;
}) {
  const docProperties = document.properties || {};
  const weekNumber = docProperties.week_number;
  const personId = docProperties.person_id;
  const projectId = docProperties.project_id;

  const isRetro = document.document_type === 'weekly_retro';
  const isReviewMode = weeklyReviewState?.isReviewMode ?? false;
  const effectiveSprintId = weeklyReviewState?.effectiveSprintId ?? null;
  const approvalState = weeklyReviewState?.approvalState ?? null;
  const approvedAt = weeklyReviewState?.approvedAt ?? null;
  const approvalComment = weeklyReviewState?.approvalComment ?? null;
  const requestChangesComment = weeklyReviewState?.requestChangesComment ?? null;
  const approverName = weeklyReviewState?.approverName ?? null;
  const currentRating = weeklyReviewState?.currentRating ?? null;

  const personName = weeklyReviewState?.personName || (personId ? `${personId.substring(0, 8)}...` : null);
  const projectName = weeklyReviewState?.projectName || (projectId ? `${projectId.substring(0, 8)}...` : null);

  function formatApprovalDate(dateStr: string): string {
    return weeklyReviewState?.formatApprovalDate(dateStr)
      ?? new Date(dateStr).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }

  return (
    <div className="space-y-4 p-4">
      {/* Header */}
      <div className="border-b border-border pb-3">
        <h3 className="text-sm font-medium text-foreground">
          {isRetro ? 'Weekly Retro' : 'Weekly Plan'}
        </h3>
        {weekNumber && (
          <p className="text-sm text-muted mt-1">Week {weekNumber}</p>
        )}
      </div>

      {isReviewMode && (
        <div className="rounded border border-border bg-border/20 px-2.5 py-2 text-xs text-muted">
          Use <span className="font-medium text-foreground">Submit Review</span> in the sub-nav to approve or request changes.
        </div>
      )}

      {/* Approval status (always shown) */}
      {effectiveSprintId && (
        <div className="border-b border-border pb-4">
          {isRetro ? (
            <div>
              <label className="text-xs font-medium text-muted mb-2 block">Performance Rating</label>
              {currentRating ? (
                <div className="mb-2">
                  <div className="flex items-center gap-2">
                    <span className={cn('text-sm font-bold', OPM_RATINGS.find(r => r.value === currentRating)?.color)}>
                      {currentRating}/5
                    </span>
                    <span className="text-xs text-muted">
                      {OPM_RATINGS.find(r => r.value === currentRating)?.label}
                    </span>
                  </div>
                  {approvedAt && (
                    <p className="text-[11px] text-muted mt-1">
                      Rated {formatApprovalDate(approvedAt)}
                      {approverName ? ` by ${approverName}` : ''}
                    </p>
                  )}
                </div>
              ) : (
                <p className="text-xs text-muted italic mb-2">Not yet rated</p>
              )}

              {approvalComment && (
                <div className="mb-3 rounded border border-border bg-border/20 px-2.5 py-2">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-muted">Approval Note</p>
                  <p className="mt-1 text-xs text-foreground">{approvalComment}</p>
                </div>
              )}

              {requestChangesComment && (
                <div className="mb-3 rounded border border-orange-500/30 bg-orange-500/10 px-2.5 py-2">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-orange-400">Changes Requested</p>
                  <p className="mt-1 text-xs text-orange-200">{requestChangesComment}</p>
                </div>
              )}
            </div>
          ) : (
            <div>
              <label className="text-xs font-medium text-muted mb-2 block">Plan Approval</label>
              <div className="mb-2">
                {approvalState === 'approved' ? (
                  <span className="inline-flex items-center gap-1 rounded bg-green-600/20 px-2 py-1 text-xs font-medium text-green-400">
                    <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M20 6L9 17l-5-5" /></svg>
                    Approved
                  </span>
                ) : approvalState === 'changed_since_approved' ? (
                  <span className="inline-flex items-center gap-1 rounded bg-orange-600/20 px-2 py-1 text-xs font-medium text-orange-400">
                    Changed since approved
                  </span>
                ) : approvalState === 'changes_requested' ? (
                  <span className="inline-flex items-center gap-1 rounded bg-orange-600/20 px-2 py-1 text-xs font-medium text-orange-400">
                    Changes requested
                  </span>
                ) : (
                  <p className="text-xs text-muted italic">Not yet approved</p>
                )}
              </div>

              {approvedAt && (
                <p className="text-[11px] text-muted mb-2">
                  {formatApprovalDate(approvedAt)}
                  {approverName ? ` by ${approverName}` : ''}
                </p>
              )}

              {approvalComment && (
                <div className="mb-3 rounded border border-border bg-border/20 px-2.5 py-2">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-muted">Approval Note</p>
                  <p className="mt-1 text-xs text-foreground">{approvalComment}</p>
                </div>
              )}

              {requestChangesComment && (
                <div className="mb-3 rounded border border-orange-500/30 bg-orange-500/10 px-2.5 py-2">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-orange-400">Changes Requested</p>
                  <p className="mt-1 text-xs text-orange-200">{requestChangesComment}</p>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Person */}
      {personId && (
        <div>
          <label className="text-xs font-medium text-muted mb-1 block">Person</label>
          <p className="text-sm text-foreground">{personName}</p>
        </div>
      )}

      {/* Project */}
      {projectId && (
        <div>
          <label className="text-xs font-medium text-muted mb-1 block">Project</label>
          <a
            href={`/documents/${projectId}/weeks`}
            className="text-sm text-accent hover:underline"
          >
            {projectName}
          </a>
        </div>
      )}

      {/* AI Quality Assistant moved to PlanQualityBanner (rendered above editor content) */}

      {/* Content History Panel */}
      <ContentHistoryPanel
        documentId={document.id}
        documentType={document.document_type}
      />
    </div>
  );
}

/** Wrapper that fetches plan content for the retro quality assistant */
function _RetroQualityAssistantWrapper({
  documentId,
  content,
  personId,
  weekNumber,
}: {
  documentId: string;
  content: Record<string, unknown>;
  personId?: string;
  weekNumber?: number;
}) {
  // Fetch the corresponding weekly plan for comparison
  const { data: planContent } = useQuery<Record<string, unknown> | null>({
    queryKey: ['weekly-plan-for-retro', personId, weekNumber],
    queryFn: async () => {
      if (!personId || !weekNumber) return null;
      const res = await apiGet(`/api/weekly-plans?person_id=${personId}&week_number=${weekNumber}`);
      if (!res.ok) return null;
      const plans = await res.json();
      if (plans.length > 0 && plans[0].content) return plans[0].content;
      return null;
    },
    enabled: !!personId && !!weekNumber,
    staleTime: 60 * 1000,
  });

  return (
    <RetroQualityAssistant
      documentId={documentId}
      content={content}
      planContent={planContent ?? null}
    />
  );
}

/**
 * PropertiesPanel - Unified component that renders the appropriate sidebar
 * based on document_type.
 *
 * Usage:
 * ```tsx
 * <PropertiesPanel
 *   document={myDocument}
 *   panelProps={typeSpecificProps}
 *   onUpdate={handleUpdate}
 * />
 * ```
 */
export function PropertiesPanel({
  document,
  panelProps,
  onUpdate,
  highlightedFields = [],
  weeklyReviewState = null,
}: PropertiesPanelProps) {
  const { isWorkspaceAdmin } = useWorkspace();
  const { user } = useAuth();

  // Compute canApprove: user is workspace admin OR is the accountable person
  // For sprints, approval uses program's accountable_id (program_accountable_id)
  // For projects, approval uses the project's accountable_id
  const canApprove = useMemo(() => {
    if (isWorkspaceAdmin) return true;
    if (!user?.id) return false;

    // Check document's accountable_id (used by projects)
    const docWithAccountable = document as { accountable_id?: string | null };
    if (docWithAccountable.accountable_id === user.id) return true;

    // For sprints, also check program_accountable_id (inherited from program)
    // and supervisor relationship (reports_to on the sprint owner's person document)
    if (document.document_type === 'sprint') {
      const sprintDoc = document;
      if (sprintDoc.program_accountable_id === user.id) return true;
      if (sprintDoc.owner_reports_to === user.id) return true;
    }

    return false;
  }, [isWorkspaceAdmin, user?.id, document]);

  // Build userNames from people in panelProps (for displaying approver names)
  const userNames = useMemo(() => {
    const names: Record<string, string> = {};
    // Try to get people from various panel props
    const props = panelProps as { people?: Array<{ id?: string; user_id?: string; name: string }> };
    if (props.people) {
      props.people.forEach(p => {
        if (p.user_id) names[p.user_id] = p.name;
        if (p.id) names[p.id] = p.name;
      });
    }
    return names;
  }, [panelProps]);

  // Callback for when approval state changes - trigger a refetch
  const handleApprovalUpdate = useCallback(() => {
    // The parent component should handle refreshing the document
    // For now, we rely on optimistic updates in the ApprovalButton
  }, []);

  const panel = useMemo(() => {
    switch (document.document_type) {
      case 'wiki': {
        const wikiProps = panelProps as WikiPanelProps;
        return (
          <WikiSidebar
            document={document}
            teamMembers={wikiProps.teamMembers || []}
            currentUserId={wikiProps.currentUserId}
            onUpdate={onUpdate}
          />
        );
      }

      case 'issue': {
        const issueProps = panelProps as IssuePanelProps;
        return (
          <IssueSidebar
            issue={document}
            teamMembers={issueProps.teamMembers || []}
            programs={issueProps.programs || []}
            projects={issueProps.projects || []}
            onUpdate={onUpdate}
            onConvert={issueProps.onConvert}
            onUndoConversion={issueProps.onUndoConversion}
            onAccept={issueProps.onAccept}
            onReject={issueProps.onReject}
            isConverting={issueProps.isConverting}
            isUndoing={issueProps.isUndoing}
            highlightedFields={highlightedFields}
            onAssociationChange={issueProps.onAssociationChange}
          />
        );
      }

      case 'project': {
        const projectProps = panelProps as ProjectPanelProps;
        return (
          <ProjectSidebar
            project={document}
            programs={projectProps.programs || []}
            people={projectProps.people || []}
            onUpdate={onUpdate}
            onConvert={projectProps.onConvert}
            onUndoConversion={projectProps.onUndoConversion}
            isConverting={projectProps.isConverting}
            isUndoing={projectProps.isUndoing}
            highlightedFields={highlightedFields}
            canApprove={canApprove}
            userNames={userNames}
            onApprovalUpdate={handleApprovalUpdate}
          />
        );
      }

      case 'sprint': {
        const sprintProps = panelProps as SprintPanelProps;
        return (
          <WeekSidebar
            sprint={document}
            onUpdate={onUpdate}
            highlightedFields={highlightedFields}
            people={sprintProps.people}
            existingSprints={sprintProps.existingSprints}
            canApprove={canApprove}
            userNames={userNames}
            onApprovalUpdate={handleApprovalUpdate}
          />
        );
      }

      case 'program': {
        const programProps = panelProps as ProgramPanelProps;
        return (
          <ProgramSidebar
            program={document}
            people={programProps.people || []}
            onUpdate={onUpdate}
            highlightedFields={highlightedFields}
          />
        );
      }

      case 'weekly_plan':
      case 'weekly_retro': {
        // Weekly plan and retro documents get a minimal sidebar with history panel
        // Names are fetched via WeeklyDocumentSidebar component
        return (
          <WeeklyDocumentSidebar
            document={document}
            weeklyReviewState={weeklyReviewState}
          />
        );
      }

      default:
        // TypeScript narrows to never here since all cases are handled
        // Cast to BaseDocument to access document_type for the fallback display
        return (
          <div className="p-4">
            <p className="text-xs text-muted">
              Document type: {(document as BaseDocument).document_type}
            </p>
          </div>
        );
    }
  }, [document, panelProps, onUpdate, highlightedFields, canApprove, userNames, handleApprovalUpdate, weeklyReviewState]);

  return panel;
}

// Re-export types for convenience
export type {
  WikiDocument,
  IssueDocument,
  ProjectDocument,
  SprintDocument,
  ProgramDocument,
  WikiPanelProps,
  IssuePanelProps,
  ProjectPanelProps,
  SprintPanelProps,
  ProgramPanelProps,
};
