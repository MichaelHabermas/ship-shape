import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = join(fileURLToPath(new URL('../../..', import.meta.url)));

export function repoPathExists(relativePath) {
  const normalized = relativePath.replace(/^\.\//, '').split('#')[0].split(':')[0];
  if (!normalized || normalized.startsWith('http')) return true;

  const direct = join(repoRoot, normalized);
  if (existsSync(direct)) return true;

  // TypeScript ESM imports often cite .js while sources are .ts
  if (normalized.endsWith('.js')) {
    const tsPath = join(repoRoot, normalized.replace(/\.js$/, '.ts'));
    if (existsSync(tsPath)) return true;
  }

  return false;
}
