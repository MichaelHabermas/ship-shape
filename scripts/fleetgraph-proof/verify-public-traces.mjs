#!/usr/bin/env node
// Verifies generated FleetGraph reviewer proof trace links without authenticated browser state.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '../..');
const defaultProofPath = path.join(repoRoot, 'web/public/fleetgraph-observability/proof/latest.json');

if (isMainModule()) {
  const proofPath = process.argv[2] ? path.resolve(repoRoot, process.argv[2]) : defaultProofPath;
  const packet = JSON.parse(await readFile(proofPath, 'utf8'));
  const traceUrls = reviewerTraceUrls(packet);
  const issues = await verifyTraceUrls(traceUrls);

  if (issues.length) {
    console.error('FleetGraph public trace verification failed:');
    for (const issue of issues) console.error(`- ${issue}`);
    process.exit(1);
  }

  console.log(`Verified ${traceUrls.length} public LangSmith trace link(s).`);
}

export function reviewerTraceUrls(packet) {
  if (Array.isArray(packet.reviewerTestCases)) {
    return packet.reviewerTestCases.map((item) => ({
      id: item.id,
      traceUrl: item.traceUrl,
    }));
  }
  return Object.entries(packet.traceEvidence?.bySignal ?? {}).map(([signal, item]) => ({
    id: signal,
    traceUrl: item.traceUrl,
  }));
}

export async function verifyTraceUrls(traceUrls) {
  const issues = [];
  if (traceUrls.length === 0) {
    issues.push('proof packet has no reviewer test-case trace URLs');
  }
  for (const item of traceUrls) {
    if (!isPublicLangSmithTraceUrl(item.traceUrl)) {
      issues.push(`case ${item.id} is not a public LangSmith trace URL: ${item.traceUrl || 'missing'}`);
      continue;
    }
    try {
      const response = await fetch(item.traceUrl, {
        redirect: 'follow',
        signal: AbortSignal.timeout(15_000),
        headers: { 'user-agent': 'ship-shape-fleetgraph-proof-verifier/1.0' },
      });
      const body = await response.text();
      if (!response.ok) {
        issues.push(`case ${item.id} trace returned HTTP ${response.status}: ${item.traceUrl}`);
      } else if (looksPrivateOrBroken(body)) {
        issues.push(`case ${item.id} trace looks private, missing, or login-gated: ${item.traceUrl}`);
      }
    } catch (error) {
      issues.push(`case ${item.id} trace could not be fetched: ${error.message}`);
    }
  }
  return issues;
}

export function isPublicLangSmithTraceUrl(value) {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'smith.langchain.com' && url.pathname.startsWith('/public/');
  } catch {
    return false;
  }
}

export function looksPrivateOrBroken(body) {
  const text = String(body ?? '').toLowerCase();
  if (!text.trim()) return true;
  return [
    'sign in',
    'sign-in',
    'log in',
    'login',
    'not found',
    '404',
    'unauthorized',
    'forbidden',
  ].some((needle) => text.includes(needle));
}

function isMainModule() {
  return process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
}
