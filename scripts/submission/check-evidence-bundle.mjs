#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gitValue, readJson, repoRelative, reviewerBundlePath } from './ledger-utils.mjs';
import { reviewerBundleRequiredFiles } from './required-artifacts.mjs';

const requiredBundleFiles = reviewerBundleRequiredFiles;

async function listTextFiles(root) {
  const entries = [];
  async function visit(path) {
    const info = await stat(path);
    if (info.isDirectory()) {
      for (const entry of await readdir(path)) await visit(resolve(path, entry));
      return;
    }
    if (info.size > 1_000_000) return;
    if (/\.(png|jpg|jpeg|gif|webp|zip|pdf|mp4|webm)$/i.test(path)) return;
    entries.push(path);
  }
  await visit(root);
  return entries;
}

function redactionFailures(path, text) {
  const failures = [];
  const checks = [
    [/\/Users\/[^"'\s]+/g, 'absolute user path'],
    [/Bearer\s+[A-Za-z0-9._~+/=-]+/g, 'bearer token'],
    [/session_id=(?!\[redacted\])[^"'\s;]+/gi, 'session cookie'],
    [/-----BEGIN [A-Z ]*PRIVATE KEY-----/g, 'private key'],
    [/postgres(?:ql)?:\/\/(?!\[redacted\]:\[redacted\]@)[^"'\s]+:[^"'\s]+@/gi, 'database URL with password'],
  ];
  for (const [pattern, label] of checks) {
    if (pattern.test(text)) failures.push(`${repoRelative(path)} contains ${label}`);
  }
  return failures;
}

async function checkBundle() {
  const errors = [];
  for (const file of requiredBundleFiles) {
    const path = resolve(reviewerBundlePath, file);
    if (!existsSync(path)) errors.push(`${file} is missing from reviewer evidence bundle`);
  }

  if (errors.length === 0) {
    const manifest = await readJson(resolve(reviewerBundlePath, 'manifest.json'));
    const currentCommit = gitValue(['rev-parse', 'HEAD']);
    if (manifest.git?.commit !== currentCommit) {
      errors.push(`manifest commit ${manifest.git?.commit || 'unknown'} does not match current commit ${currentCommit}`);
    }
    if (manifest.redaction?.obviousSecretScan !== 'passed') {
      errors.push('manifest redaction status is not passed');
    }
  }

  if (existsSync(reviewerBundlePath)) {
    for (const path of await listTextFiles(reviewerBundlePath)) {
      const text = await readFile(path, 'utf8');
      errors.push(...redactionFailures(path, text));
    }
  }

  return errors;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const errors = await checkBundle();
  if (errors.length > 0) {
    console.error(`Reviewer evidence bundle is stale or unsafe. Run pnpm submission:render-bundle.\n${errors.join('\n')}`);
    process.exit(1);
  }
  console.log('Reviewer evidence bundle is current.');
}

export { checkBundle };
