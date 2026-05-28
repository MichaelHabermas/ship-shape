import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import type { IssueState } from '@ship/shared';
import { asIssueState } from '@ship/shared';
import type { WeekDetail, WeekSprintIssue } from '@/api/schemas';
import { apiGetJson } from '@/lib/api';
import { StandupFeed } from '@/components/StandupFeed';
import { IssuesList } from '@/components/IssuesList';
import { WeekProgressGraph } from './WeekProgressGraph';

export type { WeekDetail, WeekSprintIssue };

type WeekIssue = WeekSprintIssue & { state: IssueState };

export interface WeekDetailViewProps {
  sprintId: string;
  programId?: string;
  projectId?: string;
  onBack: () => void;
}

/**
 * WeekDetailView - Three-column layout showing week burndown, standups, and issues.
 * Used in both ProgramSprintsTab and ProjectSprintsTab for viewing sprint details.
 */
export function WeekDetailView({
  sprintId,
  programId,
  projectId,
  onBack,
}: WeekDetailViewProps) {
  const [sprint, setSprint] = useState<WeekDetail | null>(null);
  const [issues, setIssues] = useState<WeekIssue[]>([]);
  const [loading, setLoading] = useState(true);

  // Fetch sprint details and issues
  useEffect(() => {
    let cancelled = false;

    async function fetchSprintData() {
      try {
        const [sprintData, issueRows] = await Promise.all([
          apiGetJson<WeekDetail>(`/api/weeks/${sprintId}`, 'Failed to fetch sprint'),
          apiGetJson<WeekSprintIssue[]>(`/api/weeks/${sprintId}/issues`, 'Failed to fetch sprint issues'),
        ]);

        if (cancelled) return;

        setSprint(sprintData);
        setIssues(
          issueRows.map((issue) => ({
            ...issue,
            state: asIssueState(issue.state),
          })),
        );
      } catch (err) {
        console.error('Failed to fetch sprint data:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchSprintData();
    return () => { cancelled = true; };
  }, [sprintId]);

  // Calculate estimates
  const sprintEstimate = issues.reduce((sum, issue) => sum + (issue.estimate || 0), 0);
  const completedEstimate = issues
    .filter(issue => issue.state === 'done')
    .reduce((sum, issue) => sum + (issue.estimate || 0), 0);

  // Compute sprint dates from sprint_number
  const computeSprintDates = (sprintNumber: number, workspaceStartDate: string) => {
    const baseDate = new Date(workspaceStartDate);
    const sprintDuration = 7; // 1 week

    const startDate = new Date(baseDate);
    startDate.setDate(startDate.getDate() + (sprintNumber - 1) * sprintDuration);

    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + sprintDuration - 1);

    const now = new Date();
    let status: 'planning' | 'active' | 'completed' = 'planning';
    if (now >= startDate && now <= endDate) {
      status = 'active';
    } else if (now > endDate) {
      status = 'completed';
    }

    return { startDate: startDate.toISOString(), endDate: endDate.toISOString(), status };
  };

  if (loading || !sprint) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-muted">Loading week...</div>
      </div>
    );
  }

  const { startDate, endDate, status } = computeSprintDates(
    sprint.sprint_number,
    sprint.workspace_sprint_start_date
  );

  const progress = sprint.issue_count > 0
    ? Math.round((sprint.completed_count / sprint.issue_count) * 100)
    : 0;

  return (
    <div className="flex flex-col h-full">
      {/* Sprint header */}
      <div className="border-b border-border p-4">
        <div className="flex items-center gap-3 mb-3">
          <button
            onClick={onBack}
            className="text-muted hover:text-foreground transition-colors"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div className="flex-1">
            <h2 className="font-semibold text-foreground">{sprint.name}</h2>
            {sprint.owner && (
              <p className="text-sm text-muted">{sprint.owner.name}</p>
            )}
          </div>
          <Link
            to={`/documents/${sprintId}`}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-muted hover:text-foreground hover:bg-border/50 rounded-md transition-colors"
            title="Open week document"
          >
            <span>Open</span>
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
          </Link>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex-1 h-2 rounded-full bg-border overflow-hidden">
            <div
              className="h-full bg-accent transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
          <span className="text-xs text-muted">
            {sprint.completed_count}/{sprint.issue_count} done
          </span>
        </div>
      </div>

      {/* Two-column layout: Left (1/3 - Progress + Standups) | Right (2/3 - Issues) */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left Column: Sprint Progress (fixed) + Standups (scrollable) */}
        <div className="w-1/3 min-w-[320px] max-w-[400px] flex-shrink-0 border-r border-border flex flex-col overflow-hidden">
          {/* Sprint Progress - Fixed */}
          <div className="flex-shrink-0 border-b border-border p-4">
            <h3 className="text-sm font-medium text-foreground mb-3">Week Progress</h3>
            {sprintEstimate > 0 ? (
              <WeekProgressGraph
                startDate={startDate}
                endDate={endDate}
                scopeHours={sprintEstimate}
                completedHours={completedEstimate}
                status={status}
              />
            ) : (
              <div className="text-sm text-muted">No estimates yet</div>
            )}
            {/* Plans are now per-person weekly_plan documents, accessible via the Weeks tab */}
          </div>

          {/* Standups - Scrollable with fixed header */}
          <div className="flex-1 overflow-hidden">
            <StandupFeed sprintId={sprintId} />
          </div>
        </div>

        {/* Right Column: Issues List (2/3) */}
        <div className="flex-1 overflow-hidden flex flex-col">
          <IssuesList
            lockedSprintId={sprintId}
            viewModes={['list', 'kanban']}
            initialViewMode="list"
            filterTabs={null}
            showCreateButton={true}
            showBacklogPicker={true}
            allowShowAllIssues={true}
            showProjectFilter={!projectId}
            inheritedContext={{
              programId,
              projectId,
              sprintId,
            }}
            emptyState={
              <div className="flex h-full items-center justify-center">
                <p className="text-muted">No issues in this week</p>
              </div>
            }
            className="flex-1"
          />
        </div>
      </div>
    </div>
  );
}
