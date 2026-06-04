// PlugForge pending acceptance inventory keeps missing live proof tied to proof-ledger IDs.
import { describe, it } from 'vitest';

const pendingLiveProofAtoms = [
  ['W6-GLOBAL-001', 'final P0/P1 executable and metric enforcement gate closes cleanly after live proof'],
  ['W6-METRIC-002', 'clean-machine TTFE measured with live /oauth/device UI approval, not SQL shortcut'],
  ['W6-METRIC-003', 'TTFE stage timings recorded from live login path, not SQL device approval'],
  ['W6-METRIC-005', 'TTFE P95 gate uses live login path, not SQL device approval'],
  ['W6-METRIC-006', 'TTFE flake loop uses live login path, not SQL device approval'],
  ['W6-CLI-001', 'packed CLI install plus live TTFE with UI device approval'],
  ['W6-CLI-002', 'live ship login with Device Grant UI approval on /oauth/device'],
  ['W6-CLI-003', 'live Device Grant flow without approveDeviceCode SQL shortcut'],
  ['W6-CLI-006', 'live docs create through authenticated CLI session'],
  ['W6-CLI-007', 'live webhooks tail with archived verified document.created JSON'],
  ['W6-CLI-010', 'live TTFE stages with UI device approval'],
  ['W6-CLI-011', 'live TTFE webhook subscription via ShipClient.webhooks.create'],
  ['W6-CLI-012', 'live TTFE document create via ShipClient.documents.create'],
  ['W6-CLI-013', 'live TTFE verified document.created event archived in evidence'],
  ['W6-CLI-014', 'live TTFE total runtime below 60s with UI device approval'],
  ['W6-INT-001', 'integration matrix proven only with live Slack, GitLab, browser, CLI, and drills'],
  ['W6-INT-002', 'CLI integration live login, create, subscription, receipt, and verification'],
  ['W6-INT-003', 'Slack integration receives signed Ship webhooks on live subscriber'],
  ['W6-INT-004', 'Slack integration posts document.created to a real Slack channel'],
  ['W6-INT-005', 'Slack integration posts issue.assigned to a real Slack channel'],
  ['W6-INT-006', 'Slack integration completes real Slack OAuth install'],
  ['W6-INT-008', 'browser SDK demo PKCE proven on deployed /sdk-demo'],
  ['W6-INT-009', 'browser SDK demo lists documents on deployed /sdk-demo after connect'],
  ['W6-INT-010', 'GitLab integration links Ship issues from real GitLab MR webhook'],
  ['W6-INT-011', 'GitLab integration wired to real GitLab project webhook'],
] as const;

describe('PlugForge pending live proof inventory', () => {
  for (const [id, requirement] of pendingLiveProofAtoms) {
    it.todo(`[${id}] ${requirement}`);
  }
});
