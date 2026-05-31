// FleetGraph reviewer blast radius panel shows visible downstream impact for a finding.
import type { FleetGraphBlastRadiusResponse, FleetGraphReviewerChain } from '@ship/shared';
import { BLAST_RADIUS_PANEL_HELP } from '@/fleetgraph/reviewer/constants';
import { Panel } from './primitives';

export function BlastRadiusPanel({
  blastRadius,
  error,
  chain,
}: {
  blastRadius: FleetGraphBlastRadiusResponse | null;
  error: string | null;
  chain: FleetGraphReviewerChain;
}) {
  if (!chain.links.findingId) {
    return (
      <Panel title="Blast radius" help={BLAST_RADIUS_PANEL_HELP}>
        <div className="text-sm text-slate-500">No finding is attached to this chain.</div>
      </Panel>
    );
  }

  if (error) {
    return (
      <Panel title="Blast radius" help={BLAST_RADIUS_PANEL_HELP}>
        <div className="text-sm text-amber-200">Blast radius unavailable.</div>
      </Panel>
    );
  }

  if (!blastRadius) {
    return (
      <Panel title="Blast radius" help={BLAST_RADIUS_PANEL_HELP}>
        <div className="text-sm text-slate-500">Loading visible impact...</div>
      </Panel>
    );
  }

  const visibleNodes = blastRadius.nodes.filter((node) => node.kind !== 'finding').slice(0, 6);
  const summary = blastRadius.summary.trim() || 'Blast radius has no visible summary yet.';

  return (
    <Panel title="Blast radius" help={BLAST_RADIUS_PANEL_HELP}>
      <div className="text-sm leading-6 text-slate-300">{summary}</div>
      <div className="mt-3 space-y-2">
        {visibleNodes.map((node) => (
          <div key={node.id} className="rounded-md border border-white/10 bg-white/[0.03] px-3 py-2">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-sm font-medium text-white">{node.title}</span>
              <span className="shrink-0 rounded border border-white/10 px-1.5 py-0.5 text-[11px] uppercase text-slate-500">{node.kind}</span>
            </div>
            {node.subtitle && <div className="mt-1 truncate text-xs text-slate-500">{node.subtitle}</div>}
          </div>
        ))}
        {visibleNodes.length === 0 && (
          <div className="text-sm text-slate-500">No visible downstream nodes yet.</div>
        )}
      </div>
      <div className="mt-3 text-xs text-slate-500">
        {blastRadius.edges.length} visible link{blastRadius.edges.length === 1 ? '' : 's'}
      </div>
    </Panel>
  );
}
