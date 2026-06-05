// PlugForge pending acceptance inventory keeps missing live proof tied to proof-ledger IDs.
import { describe, it } from 'vitest';

const pendingLiveProofAtoms = [
  ['W6-GLOBAL-001', 'final P0/P1 executable and metric enforcement gate closes cleanly after live proof'],
  ['W6-INT-001', 'integration matrix proven only with live Slack, GitLab, browser, CLI, and drills'],
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
