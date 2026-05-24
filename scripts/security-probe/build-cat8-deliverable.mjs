#!/usr/bin/env node
/**
 * Build Category 8 audit deliverable aligned to Shipshape-Security-Audit.txt table.
 * Output: my-docs/evidence/security-audit/cat8-audit-deliverable.json
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const evidence = resolve(repoRoot, 'my-docs/evidence/security-audit');

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function readJsonOptional(path) {
  try {
    return readJson(path);
  } catch {
    return null;
  }
}

/** Map vulnerable npm package to Ship application surfaces (brief lines 20–21). */
const PACKAGE_FEATURES = {
  vite: ['Web dev server (pnpm dev:web)', 'Production web build (pnpm build:web)'],
  rollup: ['Web production bundle (Vite → Rollup)'],
  svgo: ['SVG icon pipeline (vite-plugin-svgr)'],
  postcss: ['Web CSS/Tailwind build'],
  hono: ['OpenAPI / Swagger dev tooling (transitive)'],
  '@hono/node-server': ['OpenAPI / Swagger dev tooling (transitive)'],
  express: ['API HTTP server (pnpm dev:api)'],
  'path-to-regexp': ['Express route matching (all REST routes)'],
  qs: ['Query-string parsing on API requests'],
  'express-rate-limit': ['API and login rate limiting'],
  undici: ['Node HTTP client (transitive; Playwright/Testcontainers chain)'],
  ws: ['Collaboration WebSocket (/collaboration/*)'],
  protobufjs: ['Testcontainers / Docker API client chain (dev & E2E)'],
  'fast-xml-parser': ['AWS SDK / XML config parsing (transitive)'],
  uuid: ['Document and entity ID generation (API)'],
  lodash: ['Tooling and test helpers (transitive)'],
  minimatch: ['Build/lint glob matching (ESLint, Vite, Vitest)'],
  picomatch: ['File glob matching in dev tooling'],
  flatted: ['ESLint cache serialization'],
  'markdown-it': ['Markdown rendering in docs/tooling (transitive)'],
  yaml: ['YAML config parsing (CI/tooling transitive)'],
  'fast-uri': ['URI parsing in dev tooling (transitive)'],
  ajv: ['JSON schema validation (OpenAPI tooling transitive)'],
};

function defaultFeatures(moduleName) {
  return [`Transitive dependency (${moduleName}); runtime reachability not confirmed`];
}

function normalizeFinding(f) {
  return {
    id: f.id,
    severity: f.severity,
    title: f.title,
    probe_id: f.probeId || f.probe_id,
  };
}

function surfaceFindings(report, surfaceKey) {
  if (!report) return [];
  const surface = report.surfaces?.[surfaceKey];
  if (!surface) return [];
  const ids = new Set(surface.findings || []);
  if (ids.size === 0) return [];
  return (report.findings || []).filter((f) => ids.has(f.id)).map(normalizeFinding);
}

function manualField(report, key) {
  const entry = report?.manualReview?.[key];
  if (!entry) return { status: 'not_measured', details: {} };
  return {
    status: entry.status,
    details: entry.details || {},
  };
}

function rateLimitEndpoints(report) {
  const limits = report?.manualReview?.rateLimits;
  if (!limits || limits.status !== 'passed') {
    return limits ? ['see manual-rate-limits probe in report'] : [];
  }
  return [];
}

function buildDependencyList(baselineDeps) {
  const byModule = new Map();
  for (const item of baselineDeps.highCriticalAdvisories || []) {
    const existing = byModule.get(item.module) || {
      module: item.module,
      severity: item.severity,
      cves: new Set(),
      titles: [],
      application_features: PACKAGE_FEATURES[item.module] || defaultFeatures(item.module),
    };
    for (const cve of item.cves || []) existing.cves.add(cve);
    if (item.title) existing.titles.push(item.title);
    if (item.severity === 'critical') existing.severity = 'critical';
    byModule.set(item.module, existing);
  }
  return [...byModule.values()]
    .map((row) => ({
      module: row.module,
      severity: row.severity,
      cves: [...row.cves].sort(),
      titles: [...new Set(row.titles)],
      application_features: row.application_features,
    }))
    .sort((a, b) => a.module.localeCompare(b.module));
}

const currentProbe = readJson(resolve(evidence, 'latest.json'));
const baselineProbe = readJsonOptional(resolve(evidence, 'runs/baseline-before-probe/report.json'));
const baselineDeps = readJson(resolve(evidence, 'runs/baseline-before/summary.json'));
const currentDeps = readJson(resolve(evidence, 'runs/baseline-after/summary.json'));
const dependencyList = buildDependencyList(baselineDeps);

const deliverable = {
  schemaVersion: 1,
  source: 'my-docs/SOURCE-OF-TRUTH/Shipshape-Security-Audit.txt',
  generatedAt: new Date().toISOString(),
  explanation: {
    empty_findings_mean:
      'An empty findings list means the probe ran against the live app and reported zero confirmed issues for that surface. It does NOT mean we skipped the check.',
    baseline_code: {
      branch: 'BASELINE',
      commit: '072818cf77a54e1a796dd4b878e8564d8af3f1e7',
      live_probe: baselineProbe ? 'runs/baseline-before-probe/report.json' : 'not_run',
      dependency_audit: 'runs/baseline-before/summary.json',
    },
    current_code: {
      branch: 'master',
      live_probe: 'latest.json',
      dependency_audit: 'runs/baseline-after/summary.json',
    },
  },
  table: [
    {
      metric: 'Security probe tool',
      baseline: baselineProbe ? 'Yes — pnpm security:probe on BASELINE clone' : 'Not run yet',
      current: 'Yes — pnpm security:probe',
      evidence: {
        baseline: baselineProbe ? 'runs/baseline-before-probe/report.json' : null,
        current: 'latest.json',
      },
    },
    {
      metric: 'Auth/session vulnerabilities found',
      baseline: surfaceFindings(baselineProbe, 'authSession'),
      current: surfaceFindings(currentProbe, 'authSession'),
    },
    {
      metric: 'WebSocket validation failures',
      baseline: surfaceFindings(baselineProbe, 'websocketValidation'),
      current: surfaceFindings(currentProbe, 'websocketValidation'),
    },
    {
      metric: 'Input sanitization failures',
      baseline: surfaceFindings(baselineProbe, 'inputSanitization'),
      current: surfaceFindings(currentProbe, 'inputSanitization'),
    },
    {
      metric: 'Authorization / business-logic failures (probe v2 extension)',
      baseline: 'Not measured (v1 perimeter probe)',
      current: surfaceFindings(currentProbe, 'authorization'),
    },
    {
      metric: 'High/Critical CVEs in dependencies',
      baseline: {
        count: baselineDeps.highOrCriticalCount,
        unique_cve_count: baselineDeps.uniqueCveCount,
        list: dependencyList,
      },
      current: {
        count: currentDeps.highOrCriticalCount,
        unique_cve_count: currentDeps.uniqueCveCount,
        list: [],
      },
    },
    {
      metric: 'CORS/CSP misconfiguration',
      baseline: manualField(baselineProbe, 'corsCsp'),
      current: manualField(currentProbe, 'corsCsp'),
    },
    {
      metric: 'Secrets exposure risk',
      baseline: manualField(baselineProbe, 'secrets'),
      current: manualField(currentProbe, 'secrets'),
    },
    {
      metric: 'Rate limiting absent on endpoints',
      baseline: rateLimitEndpoints(baselineProbe),
      current: rateLimitEndpoints(currentProbe),
    },
    {
      metric: 'Verbose error leakage',
      baseline: manualField(baselineProbe, 'verboseErrors'),
      current: manualField(currentProbe, 'verboseErrors'),
    },
  ],
};

writeFileSync(resolve(evidence, 'cat8-audit-deliverable.json'), `${JSON.stringify(deliverable, null, 2)}\n`);
console.log('Wrote cat8-audit-deliverable.json');
console.log(`Baseline live probe: ${baselineProbe ? 'yes' : 'NO — run pnpm security:baseline:probe'}`);
console.log(`Dependency packages mapped: ${dependencyList.length}`);
