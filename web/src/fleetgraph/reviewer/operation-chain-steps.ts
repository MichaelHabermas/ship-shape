// Maps reviewer operations to durable proof-chain step keys for live drawer progress.
import type { FleetGraphReviewerChain, FleetGraphReviewerStep } from '@ship/shared';
import type { OperationKind } from './types';

const OPERATION_CHAIN_STEP_KEYS: Record<OperationKind, readonly string[]> = {
  scenario: [
    'source',
    'attention_event',
    'worker_tick',
    'graph_run',
    'trace',
    'finding',
    'notification_projection',
    'chat_human_gate',
  ],
  worker: [
    'attention_event',
    'worker_tick',
    'graph_run',
    'finding',
    'notification_projection',
  ],
  repair: [
    'source',
    'graph_run',
    'finding',
    'notification_projection',
    'chat_human_gate',
  ],
  proof: [
    'source',
    'graph_run',
    'trace',
    'finding',
    'notification_projection',
    'chat_human_gate',
  ],
};

export function chainStepsForOperation(
  kind: OperationKind,
  chain: FleetGraphReviewerChain | null,
): FleetGraphReviewerStep[] {
  if (!chain) return [];
  const keys = OPERATION_CHAIN_STEP_KEYS[kind];
  return keys
    .map((key) => chain.steps.find((step) => step.key === key))
    .filter((step): step is FleetGraphReviewerStep => Boolean(step));
}

export function activeChainStepIndex(
  steps: FleetGraphReviewerStep[],
  status: 'running' | 'passed' | 'failed',
): number {
  if (steps.length === 0) return 0;
  if (status === 'passed') return steps.length - 1;
  const failedIndex = steps.findIndex((step) => step.status === 'failed' || step.status === 'broken');
  if (status === 'failed' && failedIndex >= 0) return failedIndex;
  const pendingIndex = steps.findIndex((step) => step.status === 'pending');
  if (pendingIndex >= 0) return pendingIndex;
  if (status === 'running') {
    const nonPassIndex = steps.findIndex((step) => step.status !== 'pass');
    return nonPassIndex >= 0 ? nonPassIndex : steps.length - 1;
  }
  return steps.length - 1;
}
