import { existsSync, statSync } from 'node:fs';
import { normalize, relative, resolve, sep } from 'node:path';
import { repoRoot } from '../core/paths.mjs';

export const auditEvidenceRoot = resolve(repoRoot, 'my-docs/evidence/security-audit');

export function safeNarrativePath(narrativePath) {
  if (!narrativePath) return null;
  const full = normalize(resolve(auditEvidenceRoot, narrativePath));
  const rel = relative(auditEvidenceRoot, full);
  if (rel.startsWith('..') || rel.includes(`..${sep}`)) return null;
  if (!existsSync(full)) return null;
  try {
    if (!statSync(full).isFile()) return null;
  } catch {
    return null;
  }
  return full;
}
