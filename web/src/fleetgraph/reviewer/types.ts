// FleetGraph reviewer page types for live proof operations and drawer state.
import type { FleetGraphReviewerStep } from '@ship/shared';

export type OperationKind = 'scenario' | 'worker' | 'repair' | 'proof';
export type OperationStatus = 'running' | 'passed' | 'failed';
export type LiveOperation = {
  kind: OperationKind;
  title: string;
  status: OperationStatus;
  startedAt: number;
  completedAt?: number;
  result?: string;
  error?: string;
  detail?: string;
  outputTail?: string[];
  chainSteps?: FleetGraphReviewerStep[];
};
