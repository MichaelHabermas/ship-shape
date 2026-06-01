// FleetGraph reviewer chat panel asks bounded questions from the selected finding context.
import { useState, type FormEvent } from 'react';
import type { FleetGraphChatResponse } from '@ship/shared';
import { apiPostJson } from '@/lib/api';
import { useFleetGraphChatTurns } from '@/hooks/useFleetGraphChatTurns';
import { Panel } from './primitives';

export function ReviewerChatPanel({ findingId }: { findingId: string }) {
  const [prompt, setPrompt] = useState('What evidence proves this blocked finding and what still requires a human?');
  const [submitting, setSubmitting] = useState(false);
  const { chatTurns, beginTurn, resolveTurn, failTurn } = useFleetGraphChatTurns();

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!prompt.trim() || submitting) return;
    const { turnId, history } = beginTurn(prompt.trim());
    setSubmitting(true);
    try {
      const response = await apiPostJson<FleetGraphChatResponse>(
        '/api/fleetgraph/chat',
        {
          prompt: prompt.trim(),
          context: { kind: 'finding', findingId },
          history,
        },
        'FleetGraph reviewer chat failed',
      );
      resolveTurn(turnId, response);
    } catch (err) {
      failTurn(turnId, err instanceof Error ? err.message : 'FleetGraph reviewer chat failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Panel title="Reviewer chat" help="Asks FleetGraph from the selected finding context. It should explain evidence and uncertainty without changing the source issue.">
      <form onSubmit={submit} className="space-y-3">
        <textarea
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          className="min-h-24 w-full resize-none rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-sky-300/60"
        />
        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-md border border-sky-300/30 bg-sky-400/10 px-3 py-2 text-sm font-medium text-sky-100 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? 'Asking...' : 'Ask from finding context'}
        </button>
      </form>
      <div className="mt-4 space-y-3">
        {chatTurns.map((turn) => (
          <div key={turn.id} className="rounded-md border border-white/10 bg-white/[0.03] p-3">
            <div className="text-xs text-slate-500">{turn.prompt}</div>
            <div className="mt-2 text-sm text-slate-200">
              {turn.status === 'loading' ? 'Thinking...' : turn.response?.answer.body ?? turn.errorMessage}
            </div>
          </div>
        ))}
      </div>
    </Panel>
  );
}
