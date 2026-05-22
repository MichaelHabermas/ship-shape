import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { useReviewQueue } from '@/contexts/ReviewQueueContext';
import { apiGetJson, apiPostJson } from '@/lib/api';
import type { Document } from '@/api/schemas';

export interface WeeklyReviewDocumentRef {
  id: string;
  document_type: 'weekly_plan' | 'weekly_retro';
  properties?: {
    person_id?: string;
    project_id?: string;
    week_number?: number;
  };
}

interface ApprovalDetails {
  state: string | null;
  approvedAt: string | null;
  comment: string | null;
  feedback: string | null;
  rating: number | null;
}

interface ApprovalData {
  state?: string;
  approved_by?: string;
  approved_at?: string;
  feedback?: string | null;
  comment?: string | null;
}

export interface WeeklyReviewActionsState {
  isReviewMode: boolean;
  isRetro: boolean;
  effectiveSprintId: string | null;
  weekNumber?: number;
  personId?: string;
  projectId?: string;
  personName: string | null;
  projectName: string | null;
  queueActive: boolean;
  queueIndex: number;
  queueLength: number;
  approvalState: string | null;
  approvedAt: string | null;
  approvalComment: string | null;
  requestChangesComment: string | null;
  approverName: string | null;
  currentRating: number | null;
  approving: boolean;
  skip: () => void;
  exit: () => void;
  approvePlan: (comment: string) => Promise<boolean>;
  approveRetro: (rating: number, comment: string) => Promise<boolean>;
  requestChanges: (feedback: string) => Promise<boolean>;
  formatApprovalDate: (dateStr: string) => string;
}

export function useWeeklyReviewActions(
  weeklyDocument: WeeklyReviewDocumentRef | null
): WeeklyReviewActionsState | null {
  const [searchParams] = useSearchParams();
  const sprintIdFromQuery = searchParams.get('sprintId');
  const isReviewMode = searchParams.get('review') === 'true';

  const reviewQueue = useReviewQueue();
  const queueActive = reviewQueue?.state.active ?? false;

  const isRetro = weeklyDocument?.document_type === 'weekly_retro';
  const docProperties = weeklyDocument?.properties ?? {};
  const weekNumber = docProperties.week_number;
  const personId = docProperties.person_id;
  const projectId = docProperties.project_id;

  const [approving, setApproving] = useState(false);
  const [localApprovalOverride, setLocalApprovalOverride] = useState<ApprovalDetails | null>(null);

  // Fetch person name
  const { data: personDoc } = useQuery<{ title: string }>({
    queryKey: ['document', personId],
    queryFn: () => apiGetJson<{ title: string }>(`/api/documents/${personId}`, 'Failed to fetch person'),
    enabled: !!weeklyDocument && !!personId,
  });

  // Fetch project name
  const { data: projectDoc } = useQuery<{ title: string }>({
    queryKey: ['document', projectId],
    queryFn: () => apiGetJson<{ title: string }>(`/api/documents/${projectId}`, 'Failed to fetch project'),
    enabled: !!weeklyDocument && !!projectId,
  });

  interface SprintLookupResult {
    id: string;
  }

  interface SprintApprovalData {
    id: string;
    properties: Record<string, unknown>;
    approverName?: string;
  }

  interface WeekApprovalResponse {
    approval?: ApprovalData;
    review_rating?: { value?: number };
  }

  // Fetch sprint data with approval state + approver name in a single query
  const { data: sprintData } = useQuery<SprintApprovalData>({
    queryKey: ['sprint-approval-v2', sprintIdFromQuery || `lookup-${projectId}-${weekNumber}`, isRetro],
    queryFn: async () => {
      let sid = sprintIdFromQuery;
      if (!sid) {
        const lookup = await apiGetJson<SprintLookupResult>(
          `/api/weeks/lookup?project_id=${projectId}&sprint_number=${weekNumber}`,
          'Sprint not found'
        );
        sid = lookup.id;
      }

      const data = await apiGetJson<Document>(`/api/documents/${sid}`, 'Failed to fetch sprint');

      const props = (data.properties && typeof data.properties === 'object'
        ? data.properties
        : {}) as Record<string, unknown>;
      const approval = (isRetro ? props.review_approval : props.plan_approval) as ApprovalData | undefined;
      const result: SprintApprovalData = {
        id: data.id,
        properties: props,
      };
      if (approval?.approved_by) {
        const person = await apiGetJson<{ title: string }>(
          `/api/weeks/lookup-person?user_id=${approval.approved_by}`,
          'Failed to fetch approver'
        ).catch(() => null);
        if (person?.title) {
          result.approverName = person.title;
        }
      }
      return result;
    },
    enabled: !!weeklyDocument && (!!sprintIdFromQuery || (!!projectId && !!weekNumber)),
  });

  const effectiveSprintId = sprintData?.id || sprintIdFromQuery || null;

  // Clear local overrides when navigating between weekly docs
  useEffect(() => {
    setLocalApprovalOverride(null);
  }, [weeklyDocument?.id, effectiveSprintId]);

  // Derive approval state from sprint data (or local override after action)
  const sprintProps = (sprintData?.properties || {});
  const planApproval = (sprintProps.plan_approval as ApprovalData | null) ?? null;
  const reviewApproval = (sprintProps.review_approval as ApprovalData | null) ?? null;
  const reviewRating = (sprintProps.review_rating as { value?: number } | null) ?? null;
  const activeApproval = isRetro ? reviewApproval : planApproval;

  const approvalState = localApprovalOverride !== null
    ? localApprovalOverride.state
    : activeApproval?.state || null;
  const approvedAt = localApprovalOverride !== null
    ? localApprovalOverride.approvedAt
    : activeApproval?.approved_at || null;
  const approvalComment = localApprovalOverride !== null
    ? localApprovalOverride.comment
    : (activeApproval?.comment ?? null);
  const requestChangesComment = localApprovalOverride !== null
    ? localApprovalOverride.feedback
    : (activeApproval?.feedback ?? null);
  const approverName = sprintData?.approverName || null;
  const currentRating = localApprovalOverride !== null
    ? localApprovalOverride.rating
    : (reviewRating?.value || null);

  const personName = personDoc?.title || (personId ? `${personId.substring(0, 8)}...` : null);
  const projectName = projectDoc?.title || (projectId ? `${projectId.substring(0, 8)}...` : null);

  const formatApprovalDate = useCallback((dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) +
      ' at ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }, []);

  const approvePlan = useCallback(async (comment: string): Promise<boolean> => {
    if (!effectiveSprintId || approving) return false;

    setApproving(true);
    try {
      const data = await apiPostJson<WeekApprovalResponse>(
        `/api/weeks/${effectiveSprintId}/approve-plan`,
        { comment },
        'Failed to approve plan'
      );

      const approval = data.approval;
      setLocalApprovalOverride({
        state: approval?.state ?? 'approved',
        approvedAt: approval?.approved_at ?? new Date().toISOString(),
        comment: approval?.comment ?? (comment.trim() || null),
        feedback: null,
        rating: currentRating,
      });

      if (queueActive) reviewQueue?.advance();
      return true;
    } catch (err) {
      console.error('Error approving plan:', err);
      return false;
    } finally {
      setApproving(false);
    }
  }, [approving, currentRating, effectiveSprintId, queueActive, reviewQueue]);

  const requestChanges = useCallback(async (feedbackInput: string): Promise<boolean> => {
    if (!effectiveSprintId || approving) return false;

    const feedback = feedbackInput.trim();
    if (!feedback) return false;

    setApproving(true);
    try {
      const endpoint = isRetro ? 'request-retro-changes' : 'request-plan-changes';
      const data = await apiPostJson<WeekApprovalResponse>(
        `/api/weeks/${effectiveSprintId}/${endpoint}`,
        { feedback },
        'Failed to request changes'
      );

      const approval = data.approval;
      setLocalApprovalOverride({
        state: approval?.state ?? 'changes_requested',
        approvedAt: approval?.approved_at ?? new Date().toISOString(),
        comment: null,
        feedback: approval?.feedback ?? feedback,
        rating: currentRating,
      });

      if (queueActive) reviewQueue?.advance();
      return true;
    } catch (err) {
      console.error('Error requesting changes:', err);
      return false;
    } finally {
      setApproving(false);
    }
  }, [approving, currentRating, effectiveSprintId, isRetro, queueActive, reviewQueue]);

  const approveRetro = useCallback(async (rating: number, comment: string): Promise<boolean> => {
    if (!effectiveSprintId || !rating || approving) return false;

    setApproving(true);
    try {
      const data = await apiPostJson<WeekApprovalResponse>(
        `/api/weeks/${effectiveSprintId}/approve-review`,
        { rating, comment },
        'Failed to approve retro'
      );

      const approval = data.approval;
      const nextRating = data.review_rating?.value ?? rating;
      setLocalApprovalOverride({
        state: approval?.state ?? 'approved',
        approvedAt: approval?.approved_at ?? new Date().toISOString(),
        comment: approval?.comment ?? (comment.trim() || null),
        feedback: null,
        rating: nextRating,
      });

      if (queueActive) reviewQueue?.advance();
      return true;
    } catch (err) {
      console.error('Error approving retro:', err);
      return false;
    } finally {
      setApproving(false);
    }
  }, [approving, effectiveSprintId, queueActive, reviewQueue]);

  return useMemo(() => {
    if (!weeklyDocument) return null;

    return {
      isReviewMode,
      isRetro,
      effectiveSprintId,
      weekNumber,
      personId,
      projectId,
      personName,
      projectName,
      queueActive,
      queueIndex: reviewQueue?.state.currentIndex ?? 0,
      queueLength: reviewQueue?.state.queue.length ?? 0,
      approvalState,
      approvedAt,
      approvalComment,
      requestChangesComment,
      approverName,
      currentRating,
      approving,
      skip: () => reviewQueue?.skip(),
      exit: () => reviewQueue?.exit(),
      approvePlan,
      approveRetro,
      requestChanges,
      formatApprovalDate,
    } satisfies WeeklyReviewActionsState;
  }, [
    approvalComment,
    approvalState,
    approvePlan,
    approveRetro,
    approvedAt,
    approving,
    approverName,
    currentRating,
    effectiveSprintId,
    formatApprovalDate,
    isRetro,
    isReviewMode,
    personId,
    personName,
    projectId,
    projectName,
    queueActive,
    requestChanges,
    requestChangesComment,
    reviewQueue,
    weekNumber,
    weeklyDocument,
  ]);
}
