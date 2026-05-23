#!/usr/bin/env node
import { buildConfig } from './lib/cli.mjs';
import { ProbeHttpClient } from './lib/http-client.mjs';
import { buildReport, writeReport } from './lib/report.mjs';
import { SEVERITY_ORDER } from './lib/result-model.mjs';
import { authSessionProbes } from './probes/auth-session.mjs';
import { websocketValidationProbes } from './probes/websocket-validation.mjs';
import { inputSanitizationProbes } from './probes/input-sanitization.mjs';
import { dependencyCveProbes } from './probes/dependency-cves.mjs';
import { manualReviewProbes } from './probes/manual-review.mjs';

const registry = [
  { id: 'auth-session', quick: true, needsLogin: true, run: authSessionProbes },
  { id: 'websocket', quick: true, needsLogin: true, run: websocketValidationProbes },
  { id: 'input', quick: true, needsLogin: true, run: inputSanitizationProbes },
  { id: 'dependency', quick: false, needsLogin: false, run: dependencyCveProbes },
  { id: 'manual', quick: true, needsLogin: true, run: manualReviewProbes },
];

function selectedGroups(config) {
  return registry.filter((group) => {
    if (config.quick && !group.quick) return false;
    if (config.probe && group.id !== config.probe && !config.probe.startsWith(`${group.id}-`)) return false;
    return true;
  });
}

async function main() {
  const config = buildConfig();
  const startedAt = new Date().toISOString();
  const admin = new ProbeHttpClient(config.apiUrl);
  const member = new ProbeHttpClient(config.apiUrl);
  const groups = selectedGroups(config);

  if (groups.some((group) => group.needsLogin)) {
    const adminLogin = await admin.login(config.adminEmail, config.adminPassword);
    if (adminLogin.status >= 400) throw new Error(`Admin login failed with HTTP ${adminLogin.status}`);
    const memberLogin = await member.login(config.memberEmail, config.memberPassword);
    if (memberLogin.status >= 400) {
      console.warn(`Member login failed with HTTP ${memberLogin.status}; member-only probes may skip.`);
    }
  }

  const context = { config, clients: { admin, member } };
  const probes = [];
  for (const group of groups) {
    const results = await group.run(context);
    probes.push(...results);
  }

  const filtered = config.probe
    ? probes.filter((probe) => probe.id === config.probe || probe.id.startsWith(config.probe))
    : probes;
  if (config.probe && filtered.length === 0) throw new Error(`No probe matched "${config.probe}"`);

  const report = buildReport({ config, probes: filtered, startedAt, finishedAt: new Date().toISOString() });
  const paths = await writeReport(config, report);
  console.log(`Security probe report: ${paths.jsonPath}`);
  console.log(`Markdown summary: ${paths.mdPath}`);
  console.log(`Attack surfaces measured: ${report.summary.attackSurfacesMeasured}/4`);
  console.log(`Findings: ${report.summary.findings}`);

  if (!config.probe && !config.quick && (report.summary.attackSurfacesMeasured < 4 || report.probes.some((probe) => probe.status === 'skipped' || probe.status === 'error'))) {
    process.exit(1);
  }

  const failOn = config.failOn;
  if (failOn !== 'none') {
    const threshold = SEVERITY_ORDER.indexOf(failOn);
    const shouldFail = report.findings.some((finding) => SEVERITY_ORDER.indexOf(finding.severity) >= threshold);
    if (shouldFail) process.exit(2);
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
