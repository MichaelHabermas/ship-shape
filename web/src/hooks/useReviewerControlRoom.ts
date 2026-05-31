// Reviewer control room facade composes chain polling, blast radius, and gated proof operations.
import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useFleetGraphBlastRadius } from '@/hooks/useFleetGraphBlastRadius';
import { useFleetGraphReviewerChains } from '@/hooks/useFleetGraphReviewerChains';
import { useFleetGraphReviewerOperations } from '@/hooks/useFleetGraphReviewerOperations';

export function useReviewerControlRoom() {
  const [searchParams] = useSearchParams();
  const findingId = searchParams.get('findingId');
  const chainsState = useFleetGraphReviewerChains(findingId);
  const { blastRadius, error: blastRadiusError } = useFleetGraphBlastRadius(chainsState.selected?.links.findingId);
  const getSelectedChain = useCallback(
    () => chainsState.selected,
    [chainsState.selected],
  );
  const operations = useFleetGraphReviewerOperations(
    chainsState.refresh,
    chainsState.setError,
    getSelectedChain,
  );

  return {
    findingId,
    blastRadius,
    blastRadiusError,
    ...chainsState,
    ...operations,
  };
}
