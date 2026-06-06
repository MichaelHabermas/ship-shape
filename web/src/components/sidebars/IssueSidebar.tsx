// Issue properties sidebar edits lifecycle fields, associations, and blocker evidence.
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Combobox } from '@/components/ui/Combobox';
import { MultiAssociationChips } from '@/components/ui/MultiAssociationChips';
import { PropertyRow } from '@/components/ui/PropertyRow';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { isCascadeWarningError } from '@/hooks/useIssuesQuery';
import type { IncompleteChild, BelongsToType } from '@ship/shared';
import { ISSUE_STATE_OPTIONS, ISSUE_PRIORITY_OPTIONS_FULL } from '@ship/shared';
import { apiPost, apiDelete } from '@/lib/api';
import { readJson } from '@/api/read-json';
import type { ProgramSprintsResponse } from '@/api/schemas';
import { formatDateRange } from '@/lib/date-utils';
import {
  IssueBlockedPanel,
  IssueTriagePanel,
  UndoConversionBanner,
} from '@/components/sidebars/issue-sidebar-panels';
import { IssueExternalLinkChips } from '@/components/issues/IssueExternalLinkChips';
import {
  computeSprintDates,
  type Issue,
  type IssueIteration,
  type IssueSidebarProps,
  type Sprint,
} from '@/components/sidebars/issue-sidebar-types';

const API_URL = import.meta.env.VITE_API_URL ?? '';

export function IssueSidebar({
  issue,
  teamMembers,
  programs,
  projects = [],
  onUpdate,
  onAssociationChange,
  onConvert,
  onUndoConversion,
  onAccept,
  onReject,
  isConverting = false,
  isUndoing = false,
  highlightedFields = [],
}: IssueSidebarProps) {
  // Helper to check if a field should be highlighted
  const isHighlighted = (field: string) => highlightedFields.includes(field);
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [workspaceSprintStartDate, setWorkspaceSprintStartDate] = useState<Date | null>(null);
  const [sprintError, setSprintError] = useState<string | null>(null);
  const [iterations, setIterations] = useState<IssueIteration[]>([]);
  const [iterationsLoading, setIterationsLoading] = useState(false);
  const [iterationError, setIterationError] = useState<string | null>(null);
  const [blockerReason, setBlockerReason] = useState('');
  const [blockerSaving, setBlockerSaving] = useState(false);
  const activeIssueIdRef = useRef(issue.id);
  const iterationRequestRef = useRef(0);
  // Cascade warning state for closing parent with incomplete children
  const [cascadeWarning, setCascadeWarning] = useState<{
    open: boolean;
    pendingState: string | null;
    incompleteChildren: IncompleteChild[];
  }>({ open: false, pendingState: null, incompleteChildren: [] });

  // Get current associations from issue - memoize to prevent infinite re-renders
  const belongsTo = useMemo(() => issue.belongs_to || [], [issue.belongs_to]);
  const blockerIterations = useMemo(
    () => iterations.filter((iteration) => iteration.blockers_encountered?.trim()),
    [iterations]
  );
  const latestBlockerIteration = blockerIterations[0] ?? null;

  useEffect(() => {
    activeIssueIdRef.current = issue.id;
    setBlockerReason('');
    setBlockerSaving(false);
    setIterationsLoading(false);
  }, [issue.id]);

  // Handle state change with cascade warning detection
  const handleStateChange = async (newState: string) => {
    try {
      await onUpdate({ state: newState });
    } catch (error) {
      if (isCascadeWarningError(error)) {
        setCascadeWarning({
          open: true,
          pendingState: newState,
          incompleteChildren: error.warning.incomplete_children,
        });
      } else {
        throw error;
      }
    }
  };

  const loadIssueIterations = useCallback(async () => {
    const requestId = iterationRequestRef.current + 1;
    iterationRequestRef.current = requestId;
    const issueId = issue.id;

    const shouldApplyResult = () => (
      iterationRequestRef.current === requestId && activeIssueIdRef.current === issueId
    );

    if (issue.state !== 'blocked') {
      if (shouldApplyResult()) {
        setIterations([]);
        setIterationError(null);
      }
      return;
    }

    setIterationsLoading(true);
    setIterationError(null);
    try {
      const response = await fetch(`${API_URL}/api/issues/${issueId}/iterations`, {
        credentials: 'include',
      });
      if (!response.ok) {
        throw new Error('Failed to load blocker history');
      }
      const data = await readJson<IssueIteration[]>(response);
      if (shouldApplyResult()) {
        setIterations(data);
      }
    } catch (error) {
      if (shouldApplyResult()) {
        setIterations([]);
        setIterationError(error instanceof Error ? error.message : 'Failed to load blocker history');
      }
    } finally {
      if (shouldApplyResult()) {
        setIterationsLoading(false);
      }
    }
  }, [issue.id, issue.state]);

  const handleSaveBlockerReason = async () => {
    const trimmed = blockerReason.trim();
    if (!trimmed) return;
    const issueId = issue.id;
    const shouldApplyResult = () => activeIssueIdRef.current === issueId;

    setBlockerSaving(true);
    setIterationError(null);
    try {
      const response = await apiPost(`/api/issues/${issueId}/iterations`, {
        status: 'in_progress',
        what_attempted: 'Marked blocked from issue status UI',
        blockers_encountered: trimmed,
      });
      if (!response.ok) {
        throw new Error('Failed to save blocker reason');
      }
      if (shouldApplyResult()) {
        setBlockerReason('');
        await loadIssueIterations();
      }
    } catch (error) {
      if (shouldApplyResult()) {
        setIterationError(error instanceof Error ? error.message : 'Failed to save blocker reason');
      }
    } finally {
      if (shouldApplyResult()) {
        setBlockerSaving(false);
      }
    }
  };

  // Confirm closing parent with incomplete children
  const handleCascadeConfirm = async () => {
    if (cascadeWarning.pendingState) {
      await onUpdate({
        state: cascadeWarning.pendingState,
        confirm_orphan_children: true,
      } as Partial<Issue> & { confirm_orphan_children: boolean });
    }
    setCascadeWarning({ open: false, pendingState: null, incompleteChildren: [] });
  };

  // Cancel cascade warning
  const handleCascadeCancel = () => {
    setCascadeWarning({ open: false, pendingState: null, incompleteChildren: [] });
  };

  // Fetch sprints when issue's program changes
  useEffect(() => {
    // Get program from belongs_to
    const programAssoc = belongsTo.find(bt => bt.type === 'program');
    const programId = programAssoc?.id;

    if (!programId) {
      setSprints([]);
      setWorkspaceSprintStartDate(null);
      return;
    }

    let cancelled = false;

    fetch(`${API_URL}/api/programs/${programId}/sprints`, { credentials: 'include' })
      .then(async (res): Promise<ProgramSprintsResponse> => {
        if (!res.ok) return { weeks: [], workspace_sprint_start_date: '' };
        return readJson<ProgramSprintsResponse>(res);
      })
      .then(data => {
        if (!cancelled) {
          setSprints(data.weeks || []);
          if (data.workspace_sprint_start_date) {
            setWorkspaceSprintStartDate(new Date(data.workspace_sprint_start_date));
          }
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSprints([]);
          setWorkspaceSprintStartDate(null);
        }
      });

    return () => { cancelled = true; };
  }, [belongsTo]);

  useEffect(() => {
    loadIssueIterations();
  }, [loadIssueIterations]);

  // Add association via junction table API
  const handleAddAssociation = useCallback(async (relatedId: string, type: BelongsToType) => {
    const response = await apiPost(`/api/documents/${issue.id}/associations`, {
      related_id: relatedId,
      relationship_type: type,
    });
    if (!response.ok) {
      throw new Error('Failed to add association');
    }
    // Trigger refetch of issue data
    onAssociationChange?.();
  }, [issue.id, onAssociationChange]);

  // Remove association via junction table API
  const handleRemoveAssociation = useCallback(async (relatedId: string, type: BelongsToType) => {
    const response = await apiDelete(`/api/documents/${issue.id}/associations/${relatedId}?type=${type}`);
    if (!response.ok) {
      throw new Error('Failed to remove association');
    }
    // Trigger refetch of issue data
    onAssociationChange?.();
  }, [issue.id, onAssociationChange]);

  // Legacy program change handler (updates belongs_to via onUpdate)
  const _handleProgramChange = async (programId: string | null) => {
    // Build new belongs_to array with updated program
    const newBelongsTo = belongsTo.filter(bt => bt.type !== 'program' && bt.type !== 'sprint');
    if (programId) {
      newBelongsTo.push({ id: programId, type: 'program' });
    }
    await onUpdate({ belongs_to: newBelongsTo });
  };

  // Legacy sprint change handler
  const handleSprintChange = async (sprintId: string | null) => {
    if (sprintId && !issue.estimate) {
      setSprintError('Please add an estimate before assigning to a week');
      return;
    }
    setSprintError(null);
    // Build new belongs_to array with updated sprint
    const newBelongsTo = belongsTo.filter(bt => bt.type !== 'sprint');
    if (sprintId) {
      newBelongsTo.push({ id: sprintId, type: 'sprint' });
    }
    await onUpdate({ belongs_to: newBelongsTo });
  };

  // Get current program/sprint from belongs_to
  const currentProgramId = belongsTo.find(bt => bt.type === 'program')?.id ?? null;
  const currentSprintId = belongsTo.find(bt => bt.type === 'sprint')?.id ?? null;

  return (
    <div className="space-y-4 p-4">
      {issue.converted_from_id && onUndoConversion && (
        <UndoConversionBanner onUndoConversion={onUndoConversion} isUndoing={isUndoing} />
      )}

      {issue.state === 'triage' && onAccept && onReject && (
        <IssueTriagePanel onAccept={onAccept} onReject={onReject} />
      )}

      <PropertyRow label="Status" highlighted={isHighlighted('state')}>
        <select
          value={issue.state}
          onChange={(e) => handleStateChange(e.target.value)}
          aria-label="Status"
          className={`w-full rounded px-2 py-1 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-accent ${
            isHighlighted('state') ? 'bg-amber-500/20 border border-amber-500' : 'bg-border'
          }`}
        >
          {ISSUE_STATE_OPTIONS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </PropertyRow>

      {issue.state === 'blocked' && (
        <IssueBlockedPanel
          latestBlockerIteration={latestBlockerIteration}
          blockerReason={blockerReason}
          onBlockerReasonChange={setBlockerReason}
          onSaveBlockerReason={handleSaveBlockerReason}
          blockerSaving={blockerSaving}
          iterationsLoading={iterationsLoading}
          iterationError={iterationError}
        />
      )}

      <PropertyRow label="Priority" highlighted={isHighlighted('priority')}>
        <select
          value={issue.priority}
          onChange={(e) => onUpdate({ priority: e.target.value })}
          aria-label="Priority"
          className={`w-full rounded px-2 py-1 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-accent ${
            isHighlighted('priority') ? 'bg-amber-500/20 border border-amber-500' : 'bg-border'
          }`}
        >
          {ISSUE_PRIORITY_OPTIONS_FULL.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
      </PropertyRow>

      <PropertyRow label="Estimate">
        <div className="flex items-center gap-2">
          <input
            type="number"
            step="0.5"
            min="0"
            placeholder="—"
            aria-label="Estimate in hours"
            value={issue.estimate ?? ''}
            onChange={(e) => {
              const value = e.target.value ? parseFloat(e.target.value) : null;
              onUpdate({ estimate: value });
              if (value) setSprintError(null);
            }}
            className="w-20 rounded bg-border px-2 py-1 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-accent"
          />
          <span className="text-xs text-muted">hours</span>
        </div>
      </PropertyRow>

      <PropertyRow label="Assignee">
        <Combobox
          options={(() => {
            const options = teamMembers.map((m) => ({ value: m.user_id, label: m.name }));
            // If current assignee is archived and not in the active team members list, add them
            if (issue.assignee_id && issue.assignee_archived && issue.assignee_name) {
              const exists = options.some(o => o.value === issue.assignee_id);
              if (!exists) {
                options.unshift({ value: issue.assignee_id, label: `${issue.assignee_name} (archived)` });
              }
            }
            return options;
          })()}
          value={issue.assignee_id}
          onChange={(value) => onUpdate({ assignee_id: value })}
          placeholder="Unassigned"
          clearLabel="Unassigned"
          searchPlaceholder="Search people..."
          emptyText="No people found"
          aria-label="Assignee"
        />
      </PropertyRow>

      {/* Projects - Multi-association chips */}
      <PropertyRow label="Projects">
        <MultiAssociationChips
          associations={belongsTo}
          options={projects.map(p => ({ id: p.id, name: p.title, color: p.color, href: `/documents/${p.id}` }))}
          type="project"
          onAdd={handleAddAssociation}
          onRemove={handleRemoveAssociation}
          placeholder={projects.length > 0 ? "Add project..." : "No projects yet"}
          aria-label="Projects"
        />
      </PropertyRow>

      {/* Programs - Multi-association chips */}
      <PropertyRow label="Programs">
        <MultiAssociationChips
          associations={belongsTo}
          options={programs.map(p => ({ id: p.id, name: p.name, color: p.color, href: `/programs/${p.id}` }))}
          type="program"
          onAdd={handleAddAssociation}
          onRemove={handleRemoveAssociation}
          placeholder="Add program..."
          aria-label="Programs"
        />
      </PropertyRow>

      {/* Week - still uses single-select since weeks depend on program selection */}
      {currentProgramId && (
        <PropertyRow label="Week">
          <Combobox
            options={sprints.map((s) => {
              let dateRange = '';
              if (workspaceSprintStartDate) {
                const { start, end } = computeSprintDates(s.sprint_number, workspaceSprintStartDate);
                dateRange = formatDateRange(start, end);
              }
              return { value: s.id, label: s.name, description: dateRange };
            })}
            value={currentSprintId}
            onChange={(value) => handleSprintChange(value)}
            placeholder="No Week"
            clearLabel="No Week"
            searchPlaceholder="Search weeks..."
            emptyText="No weeks found"
            aria-label="Week"
          />
          {sprintError && (
            <p className="mt-1 text-xs text-red-500">{sprintError}</p>
          )}
        </PropertyRow>
      )}

      <PropertyRow label="Source">
        <span className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium whitespace-nowrap ${
          issue.source === 'external' ? 'bg-purple-500/20 text-purple-300' : 'bg-blue-500/20 text-blue-300'
        }`}>
          {issue.source === 'external' ? 'External' : 'Internal'}
        </span>
      </PropertyRow>

      {issue.external_links && issue.external_links.length > 0 ? (
        <PropertyRow label="External links">
          <IssueExternalLinkChips links={issue.external_links} />
        </PropertyRow>
      ) : null}

      {issue.state === 'cancelled' && issue.rejection_reason && (
        <PropertyRow label="Rejection Reason">
          <span className="text-sm text-red-300">{issue.rejection_reason}</span>
        </PropertyRow>
      )}

      {/* Document Conversion */}
      {onConvert && (
        <div className="pt-4 mt-4 border-t border-border">
          <button
            type="button"
            onClick={onConvert}
            disabled={isConverting}
            className="w-full rounded bg-accent/20 px-3 py-2 text-sm font-medium text-accent hover:bg-accent/30 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
          >
            {isConverting ? (
              <>
                <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                Converting...
              </>
            ) : (
              <>
                <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-8.707l-3-3a1 1 0 00-1.414 1.414L10.586 9H7a1 1 0 100 2h3.586l-1.293 1.293a1 1 0 101.414 1.414l3-3a1 1 0 000-1.414z" clipRule="evenodd" />
                </svg>
                Promote to Project
              </>
            )}
          </button>
          <p className="mt-1 text-xs text-muted text-center">Convert this issue into a project</p>
        </div>
      )}

      {/* Cascade Warning Dialog */}
      <ConfirmDialog
        open={cascadeWarning.open}
        title="Incomplete Sub-Issues"
        description={`This issue has ${cascadeWarning.incompleteChildren.length} incomplete sub-issue(s). Closing it will remove their parent relationship, making them top-level issues.`}
        confirmLabel="Close Anyway"
        cancelLabel="Keep Open"
        variant="destructive"
        onConfirm={handleCascadeConfirm}
        onCancel={handleCascadeCancel}
      >
        <div className="max-h-32 overflow-y-auto">
          <ul className="space-y-1 text-sm">
            {cascadeWarning.incompleteChildren.map((child) => (
              <li key={child.id} className="flex items-center gap-2 text-muted">
                <span className="font-mono text-xs text-accent">#{child.ticket_number}</span>
                <span className="truncate">{child.title}</span>
                <span className="ml-auto rounded bg-border px-1.5 py-0.5 text-xs">
                  {child.state}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </ConfirmDialog>
    </div>
  );
}
