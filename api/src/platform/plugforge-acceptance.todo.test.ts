// PlugForge pending acceptance inventory keeps missing proof tied to proof-ledger IDs.
import { describe, it } from 'vitest';

const pendingAcceptanceAtoms = [
  ['W6-GLOBAL-001', 'final P0/P1 executable and metric enforcement gate closes cleanly'],
  ['W6-METRIC-001', 'TTFE timing emits every required named stage'],
  ['W6-METRIC-002', 'clean-machine docs-only TTFE is measured and gated at <= 30 minutes'],
  ['W6-METRIC-003', 'TTFE stage names match install/login/subscription/create/receipt/verify'],
  ['W6-METRIC-005', '20-run TTFE CI sample archives P95 below 60 seconds'],
  ['W6-METRIC-006', '20-run TTFE CI sample archives 0 percent flake rate'],
  ['W6-METRIC-008', 'webhook first-attempt delivery P95 is measured below 2 seconds'],
  ['W6-METRIC-010', 'SDK production install size gate fails above 250 KB'],
  ['W6-METRIC-011', 'verifyWebhook benchmark proves less than 1 ms per call'],
  ['W6-METRIC-013', 'OAuth Authorization Code P95 target is gated and archived'],
  ['W6-METRIC-014', 'metric artifacts are archived for every PlugForge metric script'],
  ['W6-METRIC-015', 'Part 1 baseline comparator gates latency, bundle size, and query counts'],

  ['W6-OAUTH-006', 'client-secret verification has a focused constant-time regression proof'],
  ['W6-OAUTH-015', 'CLI Device Grant login honors slow_down responses while polling'],
  ['W6-OAUTH-023', 'refresh-token family expires no later than 30 days'],
  ['W6-OAUTH-024', 'access-token lifetime is pinned to the Week 6 OAuth contract'],
  ['W6-OAUTH-032', 'owner deletion deactivates OAuth apps and revokes tokens'],
  ['W6-OAUTH-033', 'admin force-rotation records reason, affected secret id, and revocation'],

  ['W6-API-010', 'generated OpenAPI validates against the OpenAPI 3.1 JSON Schema'],
  ['W6-API-012', 'public ApiError code union exactly matches the required final set'],
  ['W6-API-013', 'every public route-specific failure path is enumerated'],
  ['W6-API-017', 'cursor pagination remains stable across reordering operations'],
  ['W6-API-020', 'SDK method signatures have type-level OpenAPI operation parity'],

  ['W6-WEBHOOK-003', 'every required webhook event has a specific Zod payload schema'],
  ['W6-WEBHOOK-007', 'all required issue write events publish from the domain layer'],
  ['W6-WEBHOOK-008', 'required sprint write events publish from the domain layer'],
  ['W6-WEBHOOK-020', 'webhook delivery timeouts retry according to schedule'],
  ['W6-WEBHOOK-021', '429 webhook delivery responses retry according to schedule'],
  ['W6-WEBHOOK-029', 'single acceptance flow proves SDK subscription, signed receipt under 2s, and tamper rejection'],

  ['W6-SDK-005', 'authorizationCodeFlow helper has focused callback and token-store tests'],
  ['W6-SDK-006', 'deviceLogin helper has focused polling and slow_down tests'],
  ['W6-SDK-008', 'file and browser token stores persist through ITokenStore'],
  ['W6-SDK-009', 'ITokenStore persists app/client id and user id when known'],
  ['W6-SDK-012', 'issue and sprint iterators walk cursor pages transparently'],
  ['W6-SDK-014', 'SDK error discriminated union is fully proven'],
  ['W6-SDK-015', 'SDK error union has a compile-time exhaustive switch sentinel'],
  ['W6-SDK-016', 'SDK preserves request_id and details from API errors'],
  ['W6-SDK-017', 'SDK-only network failures map to kind network'],

  ['W6-CLI-008', 'CLI OAuth token persistence survives separate invocations'],
  ['W6-CLI-011', 'TTFE subscription is pinned to ShipClient.webhooks.create'],
  ['W6-CLI-012', 'TTFE document creation is pinned to ShipClient.documents.create'],

  ['W6-INT-001', 'final six-flow integration matrix is proven end-to-end'],
  ['W6-INT-003', 'Slack integration receives signed Ship webhooks'],
  ['W6-INT-004', 'Slack integration posts document.created through Slack OAuth'],
  ['W6-INT-005', 'Slack integration posts issue.assigned through Slack OAuth'],
  ['W6-INT-006', 'Slack integration proves Slack OAuth wiring'],
  ['W6-INT-010', 'GitLab integration links Ship issues to GitLab merge requests'],
  ['W6-INT-011', 'GitLab integration proves Ship webhook origin plus GitLab App wiring'],

  ['W6-PORTAL-010', 'rate limits are proven token-bucket based per app and token across public routes'],
  ['W6-PORTAL-011', '429 Retry-After is proven across public route coverage'],
  ['W6-PORTAL-012', 'all public API success and failure responses carry rate-limit headers'],
  ['W6-PORTAL-013', 'all public API calls record complete audit fields'],

  ['W6-AGENT-001', 'non-agent platform traffic triggers zero LLM calls'],
  ['W6-AGENT-002', 'LLM calls occur only on user-initiated agent turns'],
] as const;

describe('PlugForge pending acceptance proof inventory', () => {
  for (const [id, requirement] of pendingAcceptanceAtoms) {
    it.todo(`[${id}] ${requirement}`);
  }
});
