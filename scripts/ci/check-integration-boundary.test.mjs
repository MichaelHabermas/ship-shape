// Integration boundary checker tests prove SDK-only imports across package and source shapes.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const checkerPath = path.join(repoRoot, 'scripts/ci/check-integration-boundary.mjs');

test('allows integrations that import Ship only through @ship/sdk', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ship-integration-good-'));
  writeJson(path.join(root, 'integrations/good/package.json'), {
    name: '@fixture/good',
    type: 'module',
    peerDependencies: { '@ship/sdk': 'workspace:*' },
    devDependencies: { '@ship/sdk': 'workspace:*' },
  });
  writeFile(path.join(root, 'integrations/good/src/helper.mjs'), 'export const ok = true;\n');
  writeFile(path.join(root, 'integrations/good/src/index.mjs'), [
    "import { ShipClient, verifyWebhook } from '@ship/sdk';",
    "import { ok } from './helper.mjs';",
    'export { ShipClient, verifyWebhook, ok };',
    '',
  ].join('\n'));

  const result = runChecker(root);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Integration boundary OK/);
});

test('blocks app internals from package dependencies, require, and dynamic import', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ship-integration-bad-'));
  writeJson(path.join(root, 'integrations/bad/package.json'), {
    name: '@fixture/bad',
    type: 'module',
    dependencies: { '@ship/shared': 'workspace:*' },
  });
  writeFile(path.join(root, 'api/src/private.mjs'), 'export const internal = true;\n');
  writeFile(path.join(root, 'shared/src/private.mjs'), 'export const shared = true;\n');
  writeFile(path.join(root, 'integrations/bad/src/index.mjs'), [
    "import { PublicIssueSchema } from '@ship/shared';",
    "const api = require('../../../api/src/private.mjs');",
    "const shared = import('../../../shared/src/private.mjs');",
    'export { PublicIssueSchema, api, shared };',
    '',
  ].join('\n'));

  const result = runChecker(root);

  assert.equal(result.status, 1, result.stdout);
  assert.match(result.stderr, /@ship\/shared/);
  assert.match(result.stderr, /require|imports \.\.\/\.\.\/\.\.\/api\/src\/private\.mjs/);
  assert.match(result.stderr, /dynamic|shared\/src|relative import resolves/);
});

function runChecker(cwd) {
  return spawnSync(process.execPath, [checkerPath], {
    cwd,
    encoding: 'utf8',
  });
}

function writeJson(filePath, value) {
  writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function writeFile(filePath, contents) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents);
}
