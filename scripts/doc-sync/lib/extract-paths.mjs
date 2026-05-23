/** @typedef {{ doc: string, line: number, path: string, kind: 'link' | 'backtick' }} PathRef */

const REPO_PATH =
  /^(?:api|web|shared|scripts|e2e|docs|\.claude|\.agents)\/[\w./@-]+(?:\:\d+(?:-\d+)?)?$/;

const SKIP_IN_FENCE = new Set(['sql', 'typescript', 'ts', 'javascript', 'js', 'bash', 'sh', 'json']);

/**
 * @param {string} source
 * @param {string} docPath
 * @returns {PathRef[]}
 */
export function extractPathRefs(source, docPath) {
  /** @type {PathRef[]} */
  const refs = [];
  let inFence = false;
  let fenceLang = '';

  const lines = source.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fenceMatch = line.match(/^```(\w*)/);
    if (fenceMatch) {
      if (!inFence) {
        inFence = true;
        fenceLang = fenceMatch[1] ?? '';
      } else {
        inFence = false;
        fenceLang = '';
      }
      continue;
    }

    if (inFence && SKIP_IN_FENCE.has(fenceLang)) continue;

    for (const match of line.matchAll(/\[([^\]]*)\]\(([^)]+)\)/g)) {
      const target = match[2].trim();
      if (target.startsWith('http') || target.startsWith('#') || target.startsWith('mailto:')) continue;
      const pathPart = target.split('#')[0];
      if (looksLikeRepoPath(pathPart)) {
        refs.push({ doc: docPath, line: i + 1, path: normalizePath(pathPart, docPath), kind: 'link' });
      }
    }

    for (const match of line.matchAll(/`([^`\n]+)`/g)) {
      const candidate = match[1].trim();
      if (looksLikeRepoPath(candidate)) {
        refs.push({ doc: docPath, line: i + 1, path: normalizePath(candidate, docPath), kind: 'backtick' });
      }
    }
  }

  return refs;
}

function looksLikeRepoPath(value) {
  if (!value || value.includes(' ')) return false;
  const base = value.split('#')[0].split(':')[0];
  return REPO_PATH.test(base);
}

function normalizePath(raw, docPath) {
  let path = raw.split('#')[0];
  if (path.startsWith('./') || path.startsWith('../')) {
    const docDir = docPath.includes('/') ? docPath.slice(0, docPath.lastIndexOf('/')) : '';
    const parts = (docDir ? `${docDir}/${path}` : path).split('/');
    /** @type {string[]} */
    const resolved = [];
    for (const part of parts) {
      if (part === '' || part === '.') continue;
      if (part === '..') resolved.pop();
      else resolved.push(part);
    }
    path = resolved.join('/');
  }
  return path.replace(/^\.\//, '');
}
