// Reviewer control room facade composes chain polling, blast radius, and gated proof operations.
import { useSearchParams } from 'react-router-dom';
import { useFleetGraphBlastRadius } from '@/hooks/useFleetGraphBlastRadius';
import { useFleetGraphReviewerChains } from '@/hooks/useFleetGraphReviewerChains';
import { useFleetGraphReviewerOperations } from '@/hooks/useFleetGraphReviewerOperations';

export function useReviewerControlRoom() {
  const [searchParams] = useSearchParams();
  const findingId = searchParams.get('findingId');
  const chainsState = useFleetGraphReviewerChains(findingId);
  const { blastRadius, error: blastRadiusError } = useFleetGraphBlastRadius(chainsState.selected?.links.findingId);
  const operations = useFleetGraphReviewerOperations(
    chainsState.refresh,
    chainsState.setError,
    chainsState.selected,
  );

  return {
    findingId,
    blastRadius,
    blastRadiusError,
    ...chainsState,
    ...operations,
  };
}
