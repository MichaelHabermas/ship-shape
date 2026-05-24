import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const repoRoot = resolve(packageRoot, '../..');
export const evidenceDir = resolve(repoRoot, 'my-docs/evidence/security-audit');
