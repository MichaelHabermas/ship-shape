// PlugForge browser pending acceptance inventory marks missing reviewer-visible proof by ledger ID.
import { test } from './fixtures/isolated-env';

const pendingBrowserAtoms = [
  ['W6-INT-008', 'browser SDK demo completes Authorization Code with PKCE'],
  ['W6-INT-009', 'browser SDK demo lists authenticated user documents'],
] as const;

for (const [id, requirement] of pendingBrowserAtoms) {
  test.fixme(`[${id}] ${requirement}`, async () => {});
}
