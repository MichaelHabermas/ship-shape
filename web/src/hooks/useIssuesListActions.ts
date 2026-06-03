import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Issue, IssueListItem } from '@/contexts/IssuesContext';
import {
  useCreateIssue,
  useUpdateIssue,
  issueKeys,
} from '@/hooks/useIssuesQuery';
import type { BelongsTo, IssueState } from '@ship/shared';
import { projectKeys } from '@/hooks/useProjectsQuery';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/components/ui/Toast';
import { apiPost, readJson } from '@/lib/api';
import type { LegacyErrorResponse } from '@/api/schemas';

export interface IssuesListEffectiveContext {
  programId?: string;
  projectId?: string;
  sprintId?: string;
  assigneeId?: string;
}

export interface UseIssuesListActionsInput {
  shouldSelfFetch: boolean;
  buildBelongsTo: () => BelongsTo[];
  effectiveContext: IssuesListEffectiveContext;
  onCreateIssue?: () => Promise<Issue | null>;
  onUpdateIssue?: (id: string, updates: Partial<Issue>) => Promise<Issue | null>;
}

export function useIssuesListActions({
  shouldSelfFetch,
  buildBelongsTo,
  effectiveContext,
  onCreateIssue,
  onUpdateIssue,
}: UseIssuesListActionsInput) {
  const navigate = useNavigate();
  const updateIssueMutation = useUpdateIssue();
  const createIssueMutation = useCreateIssue();
  const { showToast } = useToast();
  const queryClient = useQueryClient();

  const [convertingIssue, setConvertingIssue] = useState<IssueListItem | null>(null);
  const [isConverting, setIsConverting] = useState(false);

  const canCreateIssue = Boolean(onCreateIssue || shouldSelfFetch);

  const handleCreateIssue = useCallback(async () => {
    if (shouldSelfFetch) {
      const belongs_to = buildBelongsTo();
      const issue = await createIssueMutation.mutateAsync({ belongs_to });
      if (issue) {
        navigate(`/documents/${issue.id}`);
      }
      return;
    }
    if (!onCreateIssue) return;
    const issue = await onCreateIssue();
    if (issue) {
      navigate(`/documents/${issue.id}`);
    }
  }, [shouldSelfFetch, buildBelongsTo, createIssueMutation, onCreateIssue, navigate]);

  const handleAddIssueToContext = useCallback(async (issue: IssueListItem) => {
    const existingBelongsTo = issue.belongs_to || [];
    const newBelongsTo = [...existingBelongsTo];

    if (effectiveContext.sprintId && !existingBelongsTo.some(b => b.id === effectiveContext.sprintId)) {
      newBelongsTo.push({ id: effectiveContext.sprintId, type: 'sprint' });
    }
    if (effectiveContext.projectId && !existingBelongsTo.some(b => b.id === effectiveContext.projectId)) {
      newBelongsTo.push({ id: effectiveContext.projectId, type: 'project' });
    }
    if (effectiveContext.programId && !existingBelongsTo.some(b => b.id === effectiveContext.programId)) {
      newBelongsTo.push({ id: effectiveContext.programId, type: 'program' });
    }

    try {
      await updateIssueMutation.mutateAsync({ id: issue.id, updates: { belongs_to: newBelongsTo } });
      showToast(`Added "${issue.title}" to context`, 'success');
      if (effectiveContext.sprintId) {
        queryClient.invalidateQueries({ queryKey: issueKeys.list({ sprintId: effectiveContext.sprintId }) });
      }
      if (effectiveContext.projectId) {
        queryClient.invalidateQueries({ queryKey: issueKeys.list({ projectId: effectiveContext.projectId }) });
      }
    } catch {
      showToast('Failed to add issue', 'error');
    }
  }, [effectiveContext, updateIssueMutation, queryClient, showToast]);

  const handleUpdateIssue = useCallback(async (id: string, updates: { state: IssueState }) => {
    if (onUpdateIssue) {
      await onUpdateIssue(id, updates);
    }
  }, [onUpdateIssue]);

  const handlePromoteToProject = useCallback((issue: IssueListItem) => {
    setConvertingIssue(issue);
  }, []);

  const executeConversion = useCallback(async () => {
    if (!convertingIssue) return;
    setIsConverting(true);
    try {
      const res = await apiPost(`/api/documents/${convertingIssue.id}/convert`, { target_type: 'project' });
      if (res.ok) {
        const data = await readJson<{ id: string }>(res);
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: issueKeys.lists() }),
          queryClient.invalidateQueries({ queryKey: projectKeys.lists() }),
        ]);
        showToast(`Issue promoted to project: ${convertingIssue.title}`, 'success');
        navigate(`/documents/${data.id}`, { replace: true });
      } else {
        const error = await readJson<LegacyErrorResponse>(res);
        showToast(error.error || 'Failed to convert issue to project', 'error');
        setIsConverting(false);
        setConvertingIssue(null);
      }
    } catch (err) {
      console.error('Failed to convert issue:', err);
      showToast('Failed to convert issue to project', 'error');
      setIsConverting(false);
      setConvertingIssue(null);
    }
  }, [convertingIssue, navigate, showToast, queryClient]);

  return {
    canCreateIssue,
    handleCreateIssue,
    handleAddIssueToContext,
    handleUpdateIssue,
    handlePromoteToProject,
    executeConversion,
    convertingIssue,
    isConverting,
    setConvertingIssue,
  };
}
