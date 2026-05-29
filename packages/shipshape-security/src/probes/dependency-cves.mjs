import { spawn } from 'node:child_process';
import { repoRoot } from '../core/cli.mjs';
import { errorResult, fail, finding, pass } from '../core/result-model.mjs';
import { runSelectedProbes } from '../core/probe-selection.mjs';

export async function dependencyCveProbes(context) {
  return runSelectedProbes(context, [
    { id: 'dependency-pnpm-audit', name: 'pnpm audit high/critical CVE check', run: pnpmAudit },
  ]);
}

async function pnpmAudit() {
  const audit = await run('pnpm', ['audit', '--json']);
  let parsed = null;
  try {
    parsed = audit.stdout ? JSON.parse(audit.stdout) : null;
  } catch {
    parsed = null;
  }
  if (!parsed) return errorResult('dependency-pnpm-audit', 'pnpm audit high/critical CVE check', audit.stderr || 'pnpm audit did not return parseable JSON');
  const advisories = extractAdvisories(parsed);
  const highCritical = advisories.filter((item) => ['high', 'critical'].includes(item.severity));
  if (highCritical.length === 0) {
    return pass('dependency-pnpm-audit', 'pnpm audit high/critical CVE check', {
      highCriticalCount: 0,
      auditExitCode: audit.code ?? 0,
      ...(audit.ok ? {} : { note: 'pnpm audit exited non-zero for lower-severity advisories only' }),
    });
  }
  return fail('dependency-pnpm-audit', 'pnpm audit high/critical CVE check', finding({
    id: 'cat8-dependency-high-critical-cves',
    probeId: 'dependency-pnpm-audit',
    title: 'High or critical dependency CVEs found',
    severity: highCritical.some((item) => item.severity === 'critical') ? 'critical' : 'high',
    category: 'dependency',
    affected: { packageName: highCritical.map((item) => item.name).join(', ') },
    expected: 'No high/critical CVEs, or each is listed with reachability and feature mapping.',
    observed: `${highCritical.length} high/critical advisory item(s) parsed from pnpm audit.`,
    evidence: { reproduction: ['Run pnpm security:probe -- --probe dependency-pnpm-audit'], advisories: highCritical },
    fixCandidate: 'Upgrade, override, remove, or document reachability for affected packages.',
  }));
}

function extractAdvisories(parsed) {
  if (!parsed) return [];
  const advisories = [];
  for (const [name, item] of Object.entries(parsed.advisories || {})) {
    advisories.push({ name: item.module_name || name, severity: item.severity, title: item.title, url: item.url });
  }
  for (const [name, item] of Object.entries(parsed.vulnerabilities || {})) {
    advisories.push({ name, severity: item.severity, via: item.via, effects: item.effects, range: item.range });
  }
  return advisories;
}

function run(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd: repoRoot, shell: false });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (error) => resolve({ ok: false, stdout, stderr: error.message }));
    child.on('close', (code) => resolve({ ok: code === 0, code, stdout, stderr }));
  });
}
