import type { ReviewCell, ReviewStatus } from './reviews-types.js';

export function needsPlanReview(cell: ReviewCell | undefined): boolean {
  if (!cell?.sprintId || !cell.hasPlan) return false;
  const approvalState = cell.planApproval?.state;
  return approvalState !== 'approved' && approvalState !== 'changes_requested';
}

export function needsRetroReview(cell: ReviewCell | undefined): boolean {
  if (!cell?.sprintId || !cell.hasRetro) return false;
  const approvalState = cell.reviewApproval?.state;
  return approvalState !== 'approved' && approvalState !== 'changes_requested';
}

export function getPlanStatus(cell: ReviewCell | undefined, weekIsPast: boolean): ReviewStatus {
  if (!cell || !cell.sprintId) return 'empty';
  if (cell.planApproval?.state === 'approved') return 'approved';
  if (cell.planApproval?.state === 'changes_requested') return 'changes_requested';
  if (cell.planApproval?.state === 'changed_since_approved') return 'changed';
  if (cell.hasPlan) return 'needs_review';
  if (weekIsPast) return 'late';
  return 'empty';
}

export function getRetroStatus(cell: ReviewCell | undefined, weekIsPast: boolean): ReviewStatus {
  if (!cell || !cell.sprintId) return 'empty';
  if (cell.reviewApproval?.state === 'changes_requested') return 'changes_requested';
  if (cell.reviewApproval?.state === 'changed_since_approved') return 'changed';
  if (cell.reviewRating) return 'approved';
  if (cell.reviewApproval?.state === 'approved') return 'approved';
  if (cell.hasRetro) return 'needs_review';
  if (weekIsPast) return 'late';
  return 'empty';
}
