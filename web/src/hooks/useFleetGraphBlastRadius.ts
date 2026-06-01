// Loads FleetGraph blast radius for a finding with stale-request protection.
import { useEffect, useRef, useState } from 'react';
import type { FleetGraphBlastRadiusResponse } from '@ship/shared';
import { apiGetJson } from '@/lib/api';

export function useFleetGraphBlastRadius(findingId: string | undefined) {
  const [blastRadius, setBlastRadius] = useState<FleetGraphBlastRadiusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  useEffect(() => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setBlastRadius(null);
    setError(null);
    if (!findingId) return;

    apiGetJson<FleetGraphBlastRadiusResponse>(
      `/api/fleetgraph/findings/${findingId}/blast-radius-map`,
      'Failed to load FleetGraph blast radius',
    ).then((response) => {
      if (requestId === requestIdRef.current) setBlastRadius(response);
    }).catch((err) => {
      if (requestId === requestIdRef.current) {
        setError(err instanceof Error ? err.message : 'Failed to load FleetGraph blast radius');
      }
    });
  }, [findingId]);

  return { blastRadius, error };
}
