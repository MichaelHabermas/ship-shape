// FleetGraph reviewer page types for live proof operations and drawer state.
export type OperationKind = 'scenario' | 'worker' | 'repair' | 'proof';
export type OperationStatus = 'running' | 'passed' | 'failed';
export type OperationStep = {
  key: string;
  label: string;
  detail: string;
};
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
};
