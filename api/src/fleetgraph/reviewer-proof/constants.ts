// Reviewer proof timing thresholds, titles, and command error type.
import { FLEETGRAPH_REVIEWER_REQUIRED_STEP_KEYS } from '@ship/shared';
export const REVIEWER_TITLE_PREFIX = '[FleetGraph Reviewer]';
export const REVIEWER_WEEK_TITLE = `${REVIEWER_TITLE_PREFIX} Live Week`;
export const LEGACY_REVIEWER_ISSUE_TITLE = `${REVIEWER_TITLE_PREFIX} Blocked credential path`;
export const REVIEWER_ISSUE_TITLE = `${REVIEWER_TITLE_PREFIX} Human unblock path`;
export const REVIEWER_PROOF_BLOCKER_TEXT = 'Waiting on reviewer proof unblock decision';
export const REQUIRED_STEP_KEYS = new Set(FLEETGRAPH_REVIEWER_REQUIRED_STEP_KEYS);
export const LIVE_WORKER_FRESH_MS = 10 * 60 * 1000;
export const TRACE_FRESH_MS = 24 * 60 * 60 * 1000;
export const LATENCY_GOAL_MS = 5 * 60 * 1000;
export const CAUSAL_TIMESTAMP_SKEW_MS = 1000;
export const PROOF_OUTPUT_TAIL_LINES = 12;
export const PROOF_COMMAND_ENV_ALLOWLIST = new Set([
  'PATH',
  'HOME',
  'USER',
  'LOGNAME',
  'SHELL',
  'TMPDIR',
  'NODE_ENV',
  'PNPM_HOME',
  'COREPACK_HOME',
  'FLEETGRAPH_PROOF_TEST_DATABASE_URL',
  'FLEETGRAPH_PROOF_TRACE_URLS_JSON',
]);

export class ReviewerProofCommandError extends Error {
  readonly command = 'pnpm fleetgraph:proof -- --mode local --no-refresh-evals --skip-tests';
  readonly outputTail: string[];

  constructor(message: string, outputTail: string[]) {
    super(message);
    this.name = 'ReviewerProofCommandError';
    this.outputTail = outputTail;
  }
}
