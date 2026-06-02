// Reviewer chain list/get, repair, worker tick, and proof chain selection.
import type {
  FleetGraphReviewerChain,
  FleetGraphReviewerChainsResponse,
  FleetGraphReviewerRepairResponse,
} from '@ship/shared';
import { preferredReviewerProofChain } from '@ship/shared';
import { pool } from '../../db/client.js';
import type { Principal } from '../../security/principal.js';
import { runFleetGraphWorkerTick } from '../execution/worker.js';
import { reviewerSummary } from './chain-build.js';
import { loadReviewerChains, loadReviewerChainsById } from './chain-sql.js';
import { ensureReviewerSourceMutationProofAndReload } from './chat-mutation.js';
import type { QueryRunner } from './types.js';

export function fleetGraphReviewerProofEnabled(): boolean {
  return ['1', 'true'].includes(process.env.FLEETGRAPH_REVIEWER_PROOF_ENABLED ?? '');
}

export async function listFleetGraphReviewerChains(input: {
  workspaceId: string;
  principal: Principal;
  limit?: number;
  db?: QueryRunner;
}): Promise<FleetGraphReviewerChainsResponse> {
  const chains = await loadReviewerChains({
    workspaceId: input.workspaceId,
    principal: input.principal,
    limit: input.limit ?? 25,
    db: input.db,
  });
  return {
    summary: reviewerSummary(chains),
    chains,
  };
}

export async function getFleetGraphReviewerChain(input: {
  workspaceId: string;
  principal: Principal;
  chainId: string;
  db?: QueryRunner;
}): Promise<FleetGraphReviewerChain | null> {
  const chains = await loadReviewerChainsById({
    workspaceId: input.workspaceId,
    principal: input.principal,
    chainId: input.chainId,
    db: input.db,
  });
  return chains[0] ?? null;
}

export async function runFleetGraphReviewerWorkerTick(input: {
  workspaceId: string;
}): Promise<{ triggered: true }> {
  await runFleetGraphWorkerTick({
    workspaceIds: [input.workspaceId],
    instanceId: `fleetgraph-reviewer-${Date.now()}`,
    graphOptions: { forceReviewerTrace: true },
  });
  return { triggered: true };
}

export async function repairFleetGraphReviewerProof(input: {
  workspaceId: string;
  principal: Principal;
  chainId: string;
  db?: QueryRunner;
}): Promise<FleetGraphReviewerRepairResponse> {
  const db = input.db ?? pool;
  const chain = await getFleetGraphReviewerChain({
    workspaceId: input.workspaceId,
    principal: input.principal,
    chainId: input.chainId,
    db,
  });
  if (!chain) {
    throw new Error('FleetGraph reviewer chain not found');
  }

  const repaired: string[] = [];
  const unsupported = chain.missing.filter((key) => key !== 'source_mutation_check');
  let refreshed = chain;
  if (chain.missing.includes('source_mutation_check')) {
    refreshed = await ensureReviewerSourceMutationProofAndReload({
      workspaceId: input.workspaceId,
      principal: input.principal,
      chain,
      db,
    });
    if (refreshed.sourceMutationCheck.passed) repaired.push('source_mutation_check');
  }

  return {
    chainId: refreshed.chainId,
    repaired,
    unsupported,
    chain: refreshed,
  };
}

export async function bestFleetGraphReviewerProofChain(input: {
  workspaceId: string;
  principal: Principal;
}): Promise<FleetGraphReviewerChain | null> {
  const chains = await listFleetGraphReviewerChains({
    workspaceId: input.workspaceId,
    principal: input.principal,
    limit: 25,
  });
  return preferredReviewerProofChain(chains.chains);
}
