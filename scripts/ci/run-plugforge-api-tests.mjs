// Runs PlugForge contract API tests from plugforge-api-tests.manifest.json.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { runCommandSync } from '../lib/run-command.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const manifestPath = path.join(rootDir, 'scripts/ci/plugforge-api-tests.manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const tests = manifest.contract_api_tests ?? [];

if (tests.length === 0) {
  console.error('plugforge-api-tests.manifest.json has no contract_api_tests');
  process.exit(1);
}

const result = runCommandSync('bash', ['./scripts/run-api-tests.sh', '--', ...tests], {
  cwd: rootDir,
});

if (!result.ok) {
  process.stderr.write(result.stderr);
  process.stderr.write(result.stdout);
  process.exit(result.code ?? 1);
}
