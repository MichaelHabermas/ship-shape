// FleetGraph draft refiner updates only FleetGraph-owned draft state.
import type { FormEvent } from 'react';
import { useState } from 'react';
import { useFleetGraphRefine } from '@/hooks/useFleetGraphQuery';

export function FleetGraphDraftRefiner({ findingId }: { findingId: string }) {
  const [instruction, setInstruction] = useState('');
  const refine = useFleetGraphRefine();
  const canSubmit = instruction.trim().length > 0 && instruction.trim().length <= 500 && !refine.isPending;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;
    const result = await refine.mutateAsync({ findingId, instruction: instruction.trim() }).catch(() => null);
    if (!result) return;
    setInstruction('');
  }

  return (
    <form className="rounded border border-border bg-background/40 p-3" onSubmit={handleSubmit}>
      <label htmlFor={`fleetgraph-refine-${findingId}`} className="text-sm font-medium text-foreground">
        Refine draft
      </label>
      <p className="mt-0.5 text-xs text-muted">This changes only FleetGraph draft text. Nothing is sent, posted, or changed in Ship.</p>
      <textarea
        id={`fleetgraph-refine-${findingId}`}
        value={instruction}
        onChange={(event) => setInstruction(event.target.value.slice(0, 500))}
        rows={3}
        placeholder="Make it softer, add the dependency, or frame it as a scope tradeoff..."
        className="mt-3 w-full rounded border border-border bg-border/30 px-3 py-2 text-sm text-foreground placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-accent"
      />
      <div className="mt-2 flex items-center justify-between gap-3">
        <span className="text-xs text-muted">{instruction.length}/500</span>
        <button
          type="submit"
          disabled={!canSubmit}
          aria-busy={refine.isPending}
          className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-accent/90 disabled:opacity-50"
        >
          {refine.isPending ? 'Refining...' : 'Refine'}
        </button>
      </div>
      {refine.isError && (
        <p className="mt-2 text-sm text-red-300">Could not refine this visible finding.</p>
      )}
      {refine.isSuccess && (
        <p className="mt-2 text-sm text-green-400">Draft updated in FleetGraph.</p>
      )}
    </form>
  );
}
