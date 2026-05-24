#!/usr/bin/env node
import { buildConfig } from './lib/cli.mjs';
import { ProbeHttpClient } from './lib/http-client.mjs';
import { buildReport, writeReport } from './lib/report.mjs';
import { SEVERITY_ORDER } from './lib/result-model.mjs';
import { MEASURED_SURFACE_COUNT, selectedGroups } from './lib/registry.mjs';
import {
  loadFindingRegistry,
  loadSecurityFindings,
  appendProbeVerifications,
  triageFindings,
} from './lib/finding-registry.mjs';
import { shouldFailSecurityProbeRun } from './lib/ci-fail.mjs';

async function main() {
  const config = buildConfig();
  const startedAt = new Date().toISOString();
  const admin = new ProbeHttpClient(config.apiUrl);
  const member = new ProbeHttpClient(config.apiUrl);
  const groups = selectedGroups(config);

  async function loginWithRetry(client, email, password) {
    let last = null;
    for (let attempt = 0; attempt < 8; attempt++) {
      last = await client.login(email, password);
      if (last.status < 400) return last;
      if (last.status !== 429) break;
      await new Promise((resolve) => setTimeout(resolve, 5000 * (attempt + 1)));
    }
    return last;
  }

  if (groups.some((group) => group.needsLogin)) {
    const adminLogin = await loginWithRetry(admin, config.adminEmail, config.adminPassword);
    if (adminLogin.status >= 400) throw new Error(`Admin login failed with HTTP ${adminLogin.status}`);
    const memberLogin = await loginWithRetry(member, config.memberEmail, config.memberPassword);
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

  const registry = loadFindingRegistry();
  const report = buildReport({
    config,
    probes: filtered,
    startedAt,
    finishedAt: new Date().toISOString(),
    registry,
  });
  const paths = await writeReport(config, report);
  if (config.recordVerifications) {
    const store = loadSecurityFindings();
    appendProbeVerifications(store, { runId: config.runId, probes: filtered });
  }
  const triage = triageFindings({ registry, probes: filtered });

  console.log(`Security probe report: ${paths.jsonPath}`);
  console.log(`Markdown summary: ${paths.mdPath}`);
  console.log(`Attack surfaces measured: ${report.summary.attackSurfacesMeasured}/${MEASURED_SURFACE_COUNT}`);
  console.log(`Findings: ${report.summary.findings}`);
  console.log(
    `Triage: known-open=${triage.counts.knownOpen}, new=${triage.counts.new}, resolved=${triage.counts.resolved}, regression=${triage.counts.regression}`
  );

  const failOn = config.failOn;
  const incompleteSurfaces = report.summary.attackSurfacesMeasured < MEASURED_SURFACE_COUNT;
  const erroredProbes = report.probes.some((probe) => probe.status === 'error');
  const skippedProbes = report.probes.some((probe) => probe.status === 'skipped');
  if (!config.probe && !config.quick) {
    if (failOn === 'new') {
      if (incompleteSurfaces || erroredProbes) {
        console.error(
          `Security probe incomplete: surfaces=${report.summary.attackSurfacesMeasured}/${MEASURED_SURFACE_COUNT}, errors=${erroredProbes}`
        );
        process.exit(1);
      }
    } else if (incompleteSurfaces || erroredProbes || skippedProbes) {
      process.exit(1);
    }
  }

  const ciFail = shouldFailSecurityProbeRun({ failOn, triage });
  if (ciFail.fail) {
    console.error(`Security probe failed (${failOn}): ${ciFail.reason}`);
    process.exit(ciFail.exitCode ?? 2);
  }
  if (failOn !== 'none' && failOn !== 'new') {
    const threshold = SEVERITY_ORDER.indexOf(failOn);
    const shouldFail = report.findings.some((finding) => SEVERITY_ORDER.indexOf(finding.severity) >= threshold);
    if (shouldFail) process.exit(2);
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
