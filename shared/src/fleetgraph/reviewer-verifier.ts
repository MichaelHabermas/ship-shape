// Shared reviewer proof gate vocabulary and chain presentation helpers for API and web.
import type {
  FleetGraphReviewerChain,
  FleetGraphReviewerProductPath,
  FleetGraphReviewerStep,
} from '../types/fleetgraph.js';

export const FLEETGRAPH_REVIEWER_REQUIRED_STEP_KEYS = [
  'source',
  'attention_event',
  'worker_tick',
  'graph_run',
  'trace',
  'finding',
  'notification_projection',
  'chat_human_gate',
] as const;

export const FLEETGRAPH_REVIEWER_PRODUCT_PATH_STEP_KEYS = [
  'source',
  'graph_run',
  'trace',
  'finding',
  'notification_projection',
  'chat_human_gate',
] as const;

export function proofGapLabel(key: string): string {
  if (key === 'source_mutation_check') return 'source unchanged after chat';
  if (key === 'latency_under_5_minutes') return 'latency under 5 minutes';
  if (key === 'trace_quality') return 'trace quality';
  if (key === 'notification_projection') return 'notification projection';
  if (key === 'chat_human_gate') return 'chat/human gate';
  if (key === 'attention_event') return 'attention event';
  if (key === 'worker_tick') return 'worker tick';
  if (key === 'causal_ordering') return 'causal ordering';
  return key.replaceAll('_', ' ');
}

export function productPathForSteps(steps: FleetGraphReviewerStep[]): FleetGraphReviewerProductPath {
  return FLEETGRAPH_REVIEWER_PRODUCT_PATH_STEP_KEYS.every(
    (key) => steps.find((step) => step.key === key)?.status === 'pass',
  )
    ? 'working'
    : 'partial';
}

export function missingLabelsForKeys(missing: string[]): string[] {
  return missing.map(proofGapLabel);
}

export function enrichReviewerChainPresentation(chain: FleetGraphReviewerChain): FleetGraphReviewerChain {
  return {
    ...chain,
    productPath: productPathForSteps(chain.steps),
    missingLabels: missingLabelsForKeys(chain.missing),
  };
}

export function preferredReviewerProofChain(chains: FleetGraphReviewerChain[]): FleetGraphReviewerChain | null {
  return chains.find((chain) => chain.scenario === 'week-blocker' && chain.status === 'complete')
    ?? chains.find((chain) => chain.status === 'complete')
    ?? chains.find((chain) => chain.scenario === 'week-blocker')
    ?? chains[0]
    ?? null;
}
