import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { repoRoot } from './repo.mjs';

/**
 * @param {string[]} patterns
 * @param {string[]} excludePatterns
 */
export function expandDocTargets(patterns, excludePatterns = []) {
  /** @type {Set<string>} */
  const files = new Set();

  for (const pattern of patterns) {
    if (pattern.includes('*')) {
      expandGlob(pattern, files);
    } else {
      files.add(pattern);
    }
  }

  for (const excluded of excludePatterns) {
    if (excluded.endsWith('/**')) {
      const prefix = excluded.slice(0, -3);
      for (const file of [...files]) {
        if (file.startsWith(prefix)) files.delete(file);
      }
    } else {
      files.delete(excluded);
    }
  }

  return [...files].sort();
}

function expandGlob(pattern, files) {
  const parts = pattern.split('/');
  /** @param {number} idx @param {string} current */
  function walk(idx, current) {
    if (idx >= parts.length) {
      if (current.endsWith('.md')) files.add(current);
      return;
    }
    const part = parts[idx];
    const full = join(repoRoot, current);
    if (part === '**') {
      if (idx === parts.length - 1) return;
      const rest = parts.slice(idx + 1).join('/');
      walkRecursive(current, rest, files);
      return;
    }
    if (part.includes('*')) {
      let entries;
      try {
        entries = readdirSync(full);
      } catch {
        return;
      }
      const re = new RegExp(`^${part.replace(/\*/g, '.*')}$`);
      for (const entry of entries) {
        if (re.test(entry)) walk(idx + 1, current ? `${current}/${entry}` : entry);
      }
      return;
    }
    walk(idx + 1, current ? `${current}/${part}` : part);
  }
  walk(0, '');
}

function walkRecursive(relativeDir, suffixPattern, files) {
  const full = join(repoRoot, relativeDir);
  let entries;
  try {
    entries = readdirSync(full);
  } catch {
    return;
  }
  for (const entry of entries) {
    const rel = relativeDir ? `${relativeDir}/${entry}` : entry;
    const entryFull = join(full, entry);
    if (statSync(entryFull).isDirectory()) {
      walkRecursive(rel, suffixPattern, files);
    } else if (entry.endsWith('.md') && matchSuffix(rel, suffixPattern)) {
      files.add(rel);
    }
  }
}

function matchSuffix(path, suffixPattern) {
  if (!suffixPattern) return path.endsWith('.md');
  const re = new RegExp(`${suffixPattern.replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*')}$`);
  return re.test(path);
}

export function loadDocTargets() {
  const configPath = join(repoRoot, 'scripts/doc-sync/doc-targets.json');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  return expandDocTargets(config.include, config.exclude);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  for (const t of loadDocTargets()) console.log(t);
}
