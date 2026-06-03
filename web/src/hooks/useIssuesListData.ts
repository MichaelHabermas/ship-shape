import { useCallback, useMemo, useState } from 'react';
import type { IssueListItem } from '@/contexts/IssuesContext';
import { useIssuesQuery } from '@/hooks/useIssuesQuery';
import type { BelongsTo } from '@ship/shared';
import { useProjectsQuery } from '@/hooks/useProjectsQuery';
import { useSprintsQuery } from '@/hooks/useWeeksQuery';

export interface UseIssuesListDataInput {
  issuesProp?: IssueListItem[];
  loadingProp?: boolean;
  lockedProgramId?: string;
  lockedProjectId?: string;
  lockedSprintId?: string;
  inheritedContext?: {
    programId?: string;
    projectId?: string;
    sprintId?: string;
    assigneeId?: string;
  };
  allowShowAllIssues?: boolean;
}

export function useIssuesListData({
  issuesProp,
  loadingProp = false,
  lockedProgramId,
  lockedProjectId,
  lockedSprintId,
  inheritedContext,
  allowShowAllIssues = false,
}: UseIssuesListDataInput) {
  const { data: projects = [] } = useProjectsQuery();
  const { data: sprintsData } = useSprintsQuery(lockedProgramId);

  const availableSprints = useMemo(() => {
    if (!sprintsData?.weeks) return [];
    return sprintsData.weeks.map(s => ({ id: s.id, name: s.name }));
  }, [sprintsData]);

  const shouldSelfFetch = Boolean(lockedProgramId || lockedProjectId || lockedSprintId);
  const [showAllIssues, setShowAllIssues] = useState(false);

  const { data: fetchedIssues, isLoading: isFetchingIssues } = useIssuesQuery(
    shouldSelfFetch ? {
      programId: lockedProgramId,
      projectId: lockedProjectId,
      sprintId: lockedSprintId,
    } : {},
    { enabled: shouldSelfFetch }
  );

  const { data: allIssuesData, isLoading: isLoadingAllIssues } = useIssuesQuery(
    {},
    { enabled: allowShowAllIssues && showAllIssues && shouldSelfFetch }
  );

  const effectiveContext = useMemo(() => {
    const projectId = inheritedContext?.projectId ?? lockedProjectId;
    const sprintId = inheritedContext?.sprintId ?? lockedSprintId;
    let programId = inheritedContext?.programId ?? lockedProgramId;

    if (projectId && !programId) {
      const project = projects.find(p => p.id === projectId);
      if (project?.program_id) {
        programId = project.program_id;
      }
    }

    return {
      programId,
      projectId,
      sprintId,
      assigneeId: inheritedContext?.assigneeId,
    };
  }, [inheritedContext, lockedProgramId, lockedProjectId, lockedSprintId, projects]);

  const buildBelongsTo = useCallback((): BelongsTo[] => {
    const belongs_to: BelongsTo[] = [];
    if (effectiveContext.programId) {
      belongs_to.push({ id: effectiveContext.programId, type: 'program' });
    }
    if (effectiveContext.projectId) {
      belongs_to.push({ id: effectiveContext.projectId, type: 'project' });
    }
    if (effectiveContext.sprintId) {
      belongs_to.push({ id: effectiveContext.sprintId, type: 'sprint' });
    }
    return belongs_to;
  }, [effectiveContext]);

  const inContextIssues = shouldSelfFetch ? (fetchedIssues ?? []) : (issuesProp ?? []);
  const loading = shouldSelfFetch
    ? (isFetchingIssues || (showAllIssues && isLoadingAllIssues))
    : loadingProp;

  const inContextIds = useMemo(() => new Set(inContextIssues.map(i => i.id)), [inContextIssues]);

  const issues = useMemo(() => {
    if (!showAllIssues || !allIssuesData) {
      return inContextIssues;
    }
    const outOfContextIssues = allIssuesData.filter(issue => !inContextIds.has(issue.id));
    return [...inContextIssues, ...outOfContextIssues];
  }, [showAllIssues, inContextIssues, allIssuesData, inContextIds]);

  return {
    issues,
    loading,
    shouldSelfFetch,
    showAllIssues,
    setShowAllIssues,
    effectiveContext,
    buildBelongsTo,
    inContextIds,
    availableSprints,
  };
}
