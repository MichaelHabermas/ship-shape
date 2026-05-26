// FleetGraph trace taxonomy keeps graph failure review consistent across runs.
export type FleetGraphTraceFailureCategory =
  | 'detector'
  | 'scope_resolution'
  | 'evidence_filtering'
  | 'recipient_selection'
  | 'reasoning'
  | 'draft_quality'
  | 'ui_gate'
  | 'trace_safety'
  | 'trace_cost_metadata';

export type FleetGraphTraceReviewCategory = {
  category: FleetGraphTraceFailureCategory;
  firstQuestion: string;
  reviewerSignal: string;
};

export const fleetGraphTraceReviewTaxonomy = [
  {
    category: 'detector',
    firstQuestion: 'Did SQL select the right candidate or quiet-exit reason before model reasoning?',
    reviewerSignal: 'Candidate rows, quiet-exit summary, dedupe decision, and zero-token negative paths.',
  },
  {
    category: 'scope_resolution',
    firstQuestion: 'Did the graph stay bounded to the source issue, sprint, finding, and visible neighbors?',
    reviewerSignal: 'Scope object, source ids, and fetch list exclude broad workspace assistant behavior.',
  },
  {
    category: 'evidence_filtering',
    firstQuestion: 'Were all user-visible claims backed by evidence visible to the recipient?',
    reviewerSignal: 'Hidden documents are omitted or converted into a restricted-context summary.',
  },
  {
    category: 'recipient_selection',
    firstQuestion: 'Did FleetGraph pick the smallest useful audience or admit no safe recipient?',
    reviewerSignal: 'Recipient rationale uses assignee, owner, role, or fallback evidence.',
  },
  {
    category: 'reasoning',
    firstQuestion: 'Did the decision follow from evidence without inventing state or priority?',
    reviewerSignal: 'Summary avoids unsupported commitment, blocked-state, or critical-priority claims.',
  },
  {
    category: 'draft_quality',
    firstQuestion: 'Is the draft actionable, editable, and tied to the blocker?',
    reviewerSignal: 'Draft names the blocker, asks for a concrete next step, and preserves uncertainty.',
  },
  {
    category: 'ui_gate',
    firstQuestion: 'Is every Ship mutation or external contact blocked behind confirmation?',
    reviewerSignal: 'Needs-confirmation output shows exact action, recipient, draft, and blocked consequence.',
  },
  {
    category: 'trace_safety',
    firstQuestion: 'Can shared trace links be reviewed without exposing private Ship data?',
    reviewerSignal: 'Trace metadata excludes raw prompts, completions, hidden IDs/titles, private excerpts, contact details, and session/user tokens.',
  },
  {
    category: 'trace_cost_metadata',
    firstQuestion: 'Can reviewers inspect path, decision, model calls, tokens, and cost metadata?',
    reviewerSignal: 'Run record includes mode, decision, trace id/url, token metadata, and cost metadata.',
  },
] as const satisfies readonly FleetGraphTraceReviewCategory[];
