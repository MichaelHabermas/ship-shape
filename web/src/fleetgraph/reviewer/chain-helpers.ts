// FleetGraph reviewer chain helpers pick canonical proof chains and label gaps.
import type { FleetGraphReviewerChain, FleetGraphReviewerRepairResponse } from '@ship/shared';
import { statusHelp } from './constants';

export function chainTooltip(chain: FleetGraphReviewerChain): string {
  const missing = chain.missing.length ? ` Missing gates: ${chain.missing.map(proofGapLabel).join(', ')}.` : '';
  const scenario = chain.scenario === 'week-blocker'
    ? 'Canonical week-blocker proof scenario.'
    : 'Historical FleetGraph run from existing database evidence.';
  return `${scenario} Status: ${chain.status}. ${statusHelp[chain.status]}${missing}`;
}

export function scenarioLabel(chain: FleetGraphReviewerChain): string {
  return chain.scenario === 'existing' ? 'historical run' : chain.scenario;
}

export function preferredReviewerProofChain(chains: FleetGraphReviewerChain[]): FleetGraphReviewerChain | null {
  return chains.find((chain) => chain.scenario === 'week-blocker' && chain.status === 'complete')
    ?? chains.find((chain) => chain.status === 'complete')
    ?? chains.find((chain) => chain.scenario === 'week-blocker')
    ?? chains[0]
    ?? null;
}

export function productPathStatus(chain: FleetGraphReviewerChain): string {
  const required = ['source', 'graph_run', 'trace', 'finding', 'notification_projection', 'chat_human_gate'];
  return required.every((key) => chain.steps.find((step) => step.key === key)?.status === 'pass')
    ? 'working'
    : 'partial';
}

export function productPathTone(chain: FleetGraphReviewerChain | null): string | undefined {
  if (!chain) return undefined;
  return productPathStatus(chain) === 'working' ? 'complete' : 'in_progress';
}

export function sourceMutationLabel(chain: FleetGraphReviewerChain): string {
  if (chain.sourceMutationCheck.passed) return 'Source fields unchanged by chat.';
  return chain.sourceMutationCheck.changedFields.includes('not_measured')
    ? 'Not measured yet.'
    : 'Source fields changed.';
}

export function proofGapLabel(key: string): string {
  if (key === 'source_mutation_check') return 'source unchanged after chat';
  if (key === 'latency_under_5_minutes') return 'latency under 5 minutes';
  if (key === 'trace_quality') return 'trace quality';
  if (key === 'notification_projection') return 'notification projection';
  if (key === 'chat_human_gate') return 'chat/human gate';
  return key.replaceAll('_', ' ');
}

export function repairResultText(result: FleetGraphReviewerRepairResponse): string {
  if (result.repaired.length > 0) return `Repaired: ${result.repaired.map(proofGapLabel).join(', ')}.`;
  if (result.unsupported.length > 0) return `No safe repair was available for: ${result.unsupported.map(proofGapLabel).join(', ')}.`;
  return 'Proof inspected. No safe missing gates needed repair.';
}

export function metricHelp(label: string, value: string): string {
  if (label === 'Product path') {
    return 'Whether the selected chain has the core FleetGraph path working: source, graph run, trace, finding, notification projection, and human gate.';
  }
  if (label === 'Submission proof') {
    return value === 'broken'
      ? 'Proof incomplete means the current proof set is not submission-ready. It often means a required proof gate is missing, not that FleetGraph itself failed.'
      : 'Overall final-submission proof status across the chains currently returned by the verifier.';
  }
  if (label === 'Canonical chain') return 'The live reviewer chain that represents the current submission proof story.';
  if (label === 'Last packet') return 'Most recent static proof packet generated from live verifier evidence in this session.';
  return 'Reviewer proof metric.';
}

export function keyValueHelp(label: string): string | null {
  if (label === 'Chain') return 'The unique reviewer proof chain ID. This is normally the FleetGraph run ID.';
  if (label === 'Run') return 'The durable fleetgraph_runs row that produced this evidence.';
  if (label === 'Finding') return 'The durable fleetgraph_findings row attached to this chain, when one exists.';
  if (label === 'Trace') return 'Reviewer-safe observability trace link after URL sanitization.';
  if (label === 'Run age') return 'How long ago this FleetGraph run was created.';
  if (label === 'Worker age') return 'How long ago the matched worker tick started.';
  return null;
}
