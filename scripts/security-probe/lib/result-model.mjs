export const SEVERITY_ORDER = ['informational', 'low', 'medium', 'high', 'critical'];

export function pass(id, name, details = {}) {
  return { id, name, status: 'passed', durationMs: 0, targetSafe: true, findingIds: [], details };
}

export function skip(id, name, skipReason) {
  return { id, name, status: 'skipped', durationMs: 0, targetSafe: true, skipReason, findingIds: [] };
}

export function errorResult(id, name, errorMessage) {
  return { id, name, status: 'error', durationMs: 0, targetSafe: true, errorMessage, findingIds: [] };
}

export function fail(id, name, finding) {
  return { id, name, status: 'failed', durationMs: 0, targetSafe: true, findingIds: [finding.id], findings: [finding] };
}

import { fingerprintForFinding } from './finding-registry.mjs';

export function finding({
  id,
  probeId,
  title,
  severity = 'medium',
  confidence = 'confirmed',
  category,
  owasp = null,
  ledgerId = null,
  fingerprint = null,
  affected = {},
  evidence = {},
  expected,
  observed,
  fixCandidate,
  safeToAutoFix = false,
}) {
  const resolvedFingerprint = fingerprint || fingerprintForFinding(probeId, id);
  return {
    id,
    probeId,
    title,
    severity,
    confidence,
    category,
    owasp,
    ledgerId,
    fingerprint: resolvedFingerprint,
    affected,
    evidence,
    expected,
    observed,
    fixCandidate,
    safeToAutoFix,
  };
}

export async function timed(resultPromise) {
  const started = Date.now();
  const result = await resultPromise;
  result.durationMs = Date.now() - started;
  return result;
}
