// CLI token-store tests prove command auth state reopens from the configured path.
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

test('tokenStoreFromParsed persists and reuses CLI OAuth tokens', async () => {
  const { tokenStoreFromParsed } = await import('../src/public-api.mjs');
  const directory = await mkdtemp(join(tmpdir(), 'ship-cli-token-store-'));
  const tokenPath = join(directory, 'tokens.json');
  try {
    const parsed = { flags: { 'token-path': tokenPath }, positionals: [] };
    await tokenStoreFromParsed(parsed).set({
      accessToken: 'cli-access',
      refreshToken: 'cli-refresh',
      clientId: 'ship_app_cli',
      userId: 'user-cli',
      workspaceId: 'workspace-cli',
    });

    assert.deepEqual(await tokenStoreFromParsed(parsed).get(), {
      accessToken: 'cli-access',
      refreshToken: 'cli-refresh',
      tokenType: undefined,
      expiresAt: undefined,
      scope: undefined,
      clientId: 'ship_app_cli',
      userId: 'user-cli',
      workspaceId: 'workspace-cli',
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
