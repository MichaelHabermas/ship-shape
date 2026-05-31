// Runs gated FleetGraph reviewer proof operations with live drawer progress state.
import { useCallback, useState } from 'react';
import { operationFailure, operationTitle } from '@/fleetgraph/reviewer/operation-catalog';
import type { LiveOperation, OperationKind } from '@/fleetgraph/reviewer/types';

export function useFleetGraphReviewerOperations(
  refresh: () => Promise<void>,
  setError: (message: string | null) => void,
) {
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [operation, setOperation] = useState<LiveOperation | null>(null);

  const runAction = useCallback(async <T>(
    kind: OperationKind,
    action: () => Promise<T>,
    onDone?: (value: T) => void,
    resultText?: (value: T) => string,
  ) => {
    if (busyAction) return;
    setBusyAction(kind);
    setError(null);
    setOperation({
      kind,
      title: operationTitle(kind),
      status: 'running',
      startedAt: Date.now(),
    });
    try {
      const result = await action();
      onDone?.(result);
      await refresh();
      setOperation((current) => current?.kind === kind ? {
        ...current,
        status: 'passed',
        completedAt: Date.now(),
        result: resultText?.(result) ?? 'Completed and refreshed live proof.',
      } : current);
    } catch (err) {
      const failure = operationFailure(err, `${operationTitle(kind)} failed`);
      console.error('[FleetGraphReviewer] operation failed', {
        kind,
        message: failure.message,
        detail: failure.detail,
        outputTail: failure.outputTail,
        error: err,
      });
      setError(failure.message);
      setOperation((current) => current?.kind === kind ? {
        ...current,
        status: 'failed',
        completedAt: Date.now(),
        error: failure.message,
        detail: failure.detail,
        outputTail: failure.outputTail,
      } : current);
    } finally {
      setBusyAction(null);
    }
  }, [busyAction, refresh, setError]);

  return {
    busyAction,
    operation,
    setOperation,
    runAction,
  };
}
