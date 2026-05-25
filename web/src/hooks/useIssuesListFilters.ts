import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { IssueListItem } from '@/api/schemas';
import {
  getProgramId,
  getProgramTitle,
  getProjectId,
  getProjectTitle,
  getSprintId,
  getSprintTitle,
} from '@/hooks/useIssuesQuery';

export interface UseIssuesListFiltersInput {
  issues: IssueListItem[];
  initialStateFilter?: string;
  onStateFilterChange?: (filter: string) => void;
  urlParamPrefix?: string;
}

export function useIssuesListFilters({
  issues,
  initialStateFilter = '',
  onStateFilterChange,
  urlParamPrefix,
}: UseIssuesListFiltersInput) {
  const [searchParams, setSearchParams] = useSearchParams();
  const stateUrlParam = urlParamPrefix ? `${urlParamPrefix}_state` : null;

  const getInitialStateFilter = () => {
    if (stateUrlParam) {
      return searchParams.get(stateUrlParam) ?? initialStateFilter;
    }
    return initialStateFilter;
  };

  const [stateFilter, setStateFilter] = useState(getInitialStateFilter);
  const [programFilter, setProgramFilter] = useState<string | null>(null);
  const [projectFilter, setProjectFilter] = useState<string | null>(null);
  const [sprintFilter, setSprintFilter] = useState<string | null>(null);

  useEffect(() => {
    if (!stateUrlParam) {
      setStateFilter(initialStateFilter);
    }
  }, [initialStateFilter, stateUrlParam]);

  useEffect(() => {
    if (stateUrlParam) {
      const urlValue = searchParams.get(stateUrlParam) ?? '';
      if (urlValue !== stateFilter) {
        setStateFilter(urlValue);
      }
    }
  }, [searchParams, stateUrlParam, stateFilter]);

  const programOptions = useMemo(() => {
    const programMap = new Map<string, string>();
    issues.forEach(issue => {
      const programId = getProgramId(issue);
      const programName = getProgramTitle(issue);
      if (programId && programName) {
        programMap.set(programId, programName);
      }
    });
    return Array.from(programMap.entries())
      .map(([id, name]) => ({ value: id, label: name }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [issues]);

  const projectOptions = useMemo(() => {
    const projectMap = new Map<string, string>();
    issues.forEach(issue => {
      const projectId = getProjectId(issue);
      const projectName = getProjectTitle(issue);
      if (projectId && projectName) {
        projectMap.set(projectId, projectName);
      }
    });
    return Array.from(projectMap.entries())
      .map(([id, name]) => ({ value: id, label: name }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [issues]);

  const sprintOptions = useMemo(() => {
    const sprintMap = new Map<string, string>();
    issues.forEach(issue => {
      const sprintId = getSprintId(issue);
      const sprintName = getSprintTitle(issue);
      if (sprintId && sprintName) {
        sprintMap.set(sprintId, sprintName);
      }
    });
    return Array.from(sprintMap.entries())
      .map(([id, name]) => ({ value: id, label: name }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [issues]);

  const filteredIssues = useMemo(() => {
    let result = issues;

    if (programFilter) {
      result = result.filter(issue => getProgramId(issue) === programFilter);
    }
    if (projectFilter) {
      result = result.filter(issue => getProjectId(issue) === projectFilter);
    }
    if (sprintFilter) {
      result = result.filter(issue => getSprintId(issue) === sprintFilter);
    }
    if (stateFilter === '__no_project__') {
      result = result.filter(issue => !getProjectId(issue));
    } else if (stateFilter) {
      const states = stateFilter.split(',');
      result = result.filter(issue => states.includes(issue.state));
    }

    return result;
  }, [issues, stateFilter, programFilter, projectFilter, sprintFilter]);

  const handleFilterChange = useCallback((newFilter: string) => {
    setStateFilter(newFilter);
    if (stateUrlParam) {
      setSearchParams((prev) => {
        if (newFilter) {
          prev.set(stateUrlParam, newFilter);
        } else {
          prev.delete(stateUrlParam);
        }
        return prev;
      });
    }
    onStateFilterChange?.(newFilter);
  }, [onStateFilterChange, stateUrlParam, setSearchParams]);

  const prevStateFilterRef = useRef(stateFilter);
  const stateFilterChanged = prevStateFilterRef.current !== stateFilter;
  useEffect(() => {
    prevStateFilterRef.current = stateFilter;
  }, [stateFilter]);

  return {
    stateFilter,
    programFilter,
    setProgramFilter,
    projectFilter,
    setProjectFilter,
    sprintFilter,
    setSprintFilter,
    programOptions,
    projectOptions,
    sprintOptions,
    filteredIssues,
    handleFilterChange,
    stateFilterChanged,
  };
}
