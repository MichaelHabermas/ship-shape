// PlugForge browser pending acceptance inventory marks missing reviewer-visible proof by ledger ID.
import { test } from './fixtures/isolated-env';

const pendingBrowserAtoms = [
  ['W6-OAUTH-005', 'browser storage never persists raw OAuth client_secret after create or rotation'],
  ['W6-OAUTH-027', 'scope upgrades require explicit re-consent'],
  ['W6-OAUTH-028', 'consent screen highlights new scopes and shows prior grants'],
  ['W6-OAUTH-029', 'authorize and consent responses set anti-framing headers'],
  ['W6-OAUTH-030', 'device verification accepts manually entered user_code'],
  ['W6-OAUTH-031', 'device verification accepts URL-prefilled user_code'],
  ['W6-OAUTH-034', 'authorize and consent POSTs are protected against CSRF'],

  ['W6-INT-008', 'browser SDK demo completes Authorization Code with PKCE'],
  ['W6-INT-009', 'browser SDK demo lists authenticated user documents'],

  ['W6-PORTAL-002', 'developer portal lists OAuth apps in browser flow'],
  ['W6-PORTAL-003', 'developer portal registers apps and shows client secret once'],
  ['W6-PORTAL-004', 'developer portal rotates client secrets with shown-once behavior'],
  ['W6-PORTAL-008', 'developer portal exposes audit views'],
  ['W6-PORTAL-009', 'developer portal avoids internal route shortcuts'],
  ['W6-PORTAL-014', 'portal audit rows are queryable by app'],
] as const;

for (const [id, requirement] of pendingBrowserAtoms) {
  test.fixme(`[${id}] ${requirement}`, async () => {});
}
