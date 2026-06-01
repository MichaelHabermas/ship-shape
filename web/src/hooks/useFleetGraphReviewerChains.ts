// Polls FleetGraph reviewer chains and keeps URL selection in sync with the scenario rail.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FleetGraphReviewerChainsResponse } from '@ship/shared';
import { preferredReviewerProofChain } from '@ship/shared';
import { apiGetJson } from '@/lib/api';

export function useFleetGraphReviewerChains(findingId: string | null) {
  const [data, setData] = useState<FleetGraphReviewerChainsResponse | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(findingId);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const refreshIdRef = useRef(0);

  const refresh = useCallback(async (options: { showLoading?: boolean } = {}) => {
    const requestId = refreshIdRef.current + 1;
    refreshIdRef.current = requestId;
    if (options.showLoading !== false) {
      setLoading(true);
      setError(null);
    }
    try {
      const response = await apiGetJson<FleetGraphReviewerChainsResponse>(
        '/api/fleetgraph/reviewer/chains?limit=25',
        'Failed to load FleetGraph reviewer chains',
      );
      if (requestId !== refreshIdRef.current) return;
      setData(response);
      setSelectedId((current) => {
        if (current && response.chains.some((chain) => chain.chainId === current || chain.links.findingId === current)) {
          return current;
        }
        return response.summary.preferredChainId
          ?? preferredReviewerProofChain(response.chains)?.chainId
          ?? null;
      });
    } catch (err) {
      if (requestId !== refreshIdRef.current) return;
      setError(err instanceof Error ? err.message : 'Failed to load reviewer chains');
    } finally {
      if (requestId === refreshIdRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    const poll = async (showLoading = false) => {
      await refresh({ showLoading });
      if (!cancelled) timer = window.setTimeout(() => void poll(false), 10_000);
    };
    void poll(true);
    return () => {
      cancelled = true;
      refreshIdRef.current += 1;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [refresh]);

  const chains = data?.chains ?? [];
  const selected = useMemo(() => (
    chains.find((chain) => chain.chainId === selectedId || chain.links.findingId === selectedId)
      ?? preferredReviewerProofChain(chains)
      ?? null
  ), [chains, selectedId]);

  useEffect(() => {
    if (findingId && selected?.chainId && findingId !== selected.chainId) {
      setSelectedId(findingId);
    }
  }, [findingId, selected?.chainId]);

  return {
    data,
    chains,
    selected,
    selectedId,
    setSelectedId,
    loading,
    error,
    setError,
    refresh,
  };
}
