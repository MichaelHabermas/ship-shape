// FleetGraph reviewer UI constants for status styling and panel copy.
import type { FleetGraphReviewerChain } from '@ship/shared';

export const BLAST_RADIUS_PANEL_HELP =
  'Visible issue, week, project, program, person, and related finding impact for this FleetGraph finding.';

export const statusTone: Record<FleetGraphReviewerChain['status'], string> = {
  complete: 'border-emerald-400/40 bg-emerald-400/10 text-emerald-200',
  in_progress: 'border-sky-400/40 bg-sky-400/10 text-sky-200',
  broken: 'border-amber-400/40 bg-amber-400/10 text-amber-200',
  failed: 'border-rose-400/40 bg-rose-400/10 text-rose-200',
};

export const statusHelp: Record<FleetGraphReviewerChain['status'], string> = {
  complete: 'Every required reviewer-proof gate passed for this chain.',
  in_progress: 'The chain has started, but one or more required proof rows has not appeared yet.',
  broken: 'Proof incomplete: one or more submission-proof gates is missing or inconsistent. This does not necessarily mean the product path failed.',
  failed: 'The graph run errored and this chain cannot be used as proof.',
};
