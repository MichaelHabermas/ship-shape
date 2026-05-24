import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { repoRoot } from './cli.mjs';
import {
  DEFAULT_STORE_PATH,
  GENERATED_LEDGER_PATH,
  loadSecurityFindings,
} from './security-findings-store.mjs';
import { renderSecurityFindingsLedger } from './security-findings-render.mjs';
import { fingerprintForFinding } from './security-findings-store.mjs';

const VALID_STATUSES = new Set(['open', 'fixed', 'deferred', 'accepted_risk', 'in-progress']);
const VALID_SEVERITIES = new Set(['critical', 'high', 'medium', 'low', 'info']);
const VALID_ROLES = new Set(['regression', 'control']);

export function validateSecurityFindings(store, options = {}) {
  const errors = [];
  const warnings = [];

  if (store.schemaVersion !== 1) {
    errors.push(`Unsupported schemaVersion: ${store.schemaVersion}`);
  }

  const ids = new Set();
  for (const finding of store.findings) {
    if (!/^SS-FIND-\d{3}$/.test(finding.id)) {
      errors.push(`Invalid finding id: ${finding.id}`);
    }
    if (ids.has(finding.id)) errors.push(`Duplicate finding id: ${finding.id}`);
    ids.add(finding.id);

    if (!VALID_STATUSES.has(finding.status)) {
      errors.push(`${finding.id}: invalid status "${finding.status}"`);
    }
    if (!VALID_SEVERITIES.has(finding.severity)) {
      errors.push(`${finding.id}: invalid severity "${finding.severity}"`);
    }
    if (!finding.title) errors.push(`${finding.id}: missing title`);
    if (!finding.definition && options.requireDefinition) {
      warnings.push(`${finding.id}: missing definition`);
    }

    const fingerprints = new Set();
    for (const probe of finding.probes || []) {
      const expected = fingerprintForFinding(probe.probeId, probe.findingId);
      if (probe.fingerprint !== expected) {
        errors.push(
          `${finding.id}: fingerprint mismatch for ${probe.probeId} (expected ${expected})`
        );
      }
      if (fingerprints.has(probe.fingerprint)) {
        errors.push(`${finding.id}: duplicate probe fingerprint ${probe.fingerprint}`);
      }
      fingerprints.add(probe.fingerprint);
      if (!VALID_ROLES.has(probe.role)) {
        errors.push(`${finding.id}: invalid probe role "${probe.role}"`);
      }
    }
  }

  if (options.expectedFindingCount && store.findings.length !== options.expectedFindingCount) {
    errors.push(
      `Expected ${options.expectedFindingCount} findings, got ${store.findings.length}`
    );
  }

  return { ok: errors.length === 0, errors, warnings };
}

export function checkGeneratedLedgerFreshness(store, ledgerPath = GENERATED_LEDGER_PATH) {
  if (!existsSync(ledgerPath)) {
    return { ok: false, errors: [`Generated ledger missing: ${ledgerPath}`], warnings: [] };
  }
  const onDisk = readFileSync(ledgerPath, 'utf8');
  const expected = renderSecurityFindingsLedger(store);
  if (onDisk !== expected) {
    return {
      ok: false,
      errors: ['security-findings-ledger.md is stale; run pnpm security:findings:render'],
      warnings: [],
    };
  }
  return { ok: true, errors: [], warnings: [] };
}

export function checkProbeFingerprintsInStore(store, probeModules = []) {
  const errors = [];
  const known = new Set();
  for (const finding of store.findings) {
    for (const probe of finding.probes) {
      known.add(probe.fingerprint);
    }
  }
  for (const { probeId, findingId } of probeModules) {
    const fp = fingerprintForFinding(probeId, findingId);
    if (!known.has(fp)) {
      errors.push(`Probe fingerprint not in store: ${probeId}:${findingId} (${fp})`);
    }
  }
  return { ok: errors.length === 0, errors, warnings: [] };
}

export function runSecurityFindingsCheck(options = {}) {
  const storePath = options.storePath || DEFAULT_STORE_PATH;
  const store = loadSecurityFindings(storePath);
  const validation = validateSecurityFindings(store, {
    expectedFindingCount: options.expectedFindingCount ?? 34,
    requireDefinition: true,
  });
  const ledger = checkGeneratedLedgerFreshness(store, options.ledgerPath);
  const legacyRegistry = resolve(
    repoRoot,
    'my-docs/evidence/security-audit/probe-finding-registry.json'
  );
  const legacyErrors = existsSync(legacyRegistry)
    ? ['probe-finding-registry.json must be removed after migration (use security-findings.json)']
    : [];

  const allErrors = [...validation.errors, ...ledger.errors, ...legacyErrors];
  const allWarnings = [...validation.warnings, ...ledger.warnings];

  return {
    ok: allErrors.length === 0,
    errors: allErrors,
    warnings: allWarnings,
  };
}
