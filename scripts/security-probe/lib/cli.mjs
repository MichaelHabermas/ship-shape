import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

export function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (!arg.startsWith('--')) continue;
    const [rawKey, inlineValue] = arg.slice(2).split('=', 2);
    const key = rawKey.replace(/-([a-z])/g, (_, char) => char.toUpperCase());
    if (inlineValue !== undefined) {
      options[key] = inlineValue;
      continue;
    }
    const next = argv[index + 1];
    if (next && !next.startsWith('--')) {
      options[key] = next;
      index++;
    } else {
      options[key] = true;
    }
  }
  return options;
}

function optionEnabled(value) {
  return value === true || value === 'true' || value === '1' || value === 'yes';
}

function optionDisabled(value) {
  return value === true || value === 'true' || value === '1' || value === 'yes';
}

export function defaultRunId(date = new Date()) {
  return `cat8-${date.toISOString().replace(/[:.]/g, '-')}`;
}

export function validateRunId(runId) {
  if (!/^[a-zA-Z0-9._-]+$/.test(runId)) {
    throw new Error(`Invalid run id "${runId}"`);
  }
  return runId;
}

function readPortsFile() {
  const path = resolve(repoRoot, '.ports');
  if (!existsSync(path)) return {};
  const text = readFileSync(path, 'utf8');
  const api = text.match(/^API=(\d+)/m)?.[1];
  const web = text.match(/^WEB=(\d+)/m)?.[1];
  return { api, web };
}

export function buildConfig(argv = process.argv.slice(2), env = process.env) {
  const options = parseArgs(argv);
  const ports = readPortsFile();
  const apiUrl = String(
    options.apiUrl ||
      options.baseUrl ||
      env.SECURITY_PROBE_API_URL ||
      env.SECURITY_PROBE_BASE_URL ||
      (ports.api ? `http://localhost:${ports.api}` : 'http://localhost:3000')
  ).replace(/\/$/, '');
  const webUrl = String(
    options.webUrl ||
      env.SECURITY_PROBE_WEB_URL ||
      (ports.web ? `http://localhost:${ports.web}` : 'http://localhost:5173')
  ).replace(/\/$/, '');
  const target = options.target || (apiUrl.includes('localhost') || apiUrl.includes('127.0.0.1') ? 'local' : 'remote');
  const allowWrite = target === 'local' ? !optionDisabled(options.noWrite) : optionEnabled(options.allowWrite);
  const allowStress = target === 'local' ? !optionDisabled(options.noStress) : optionEnabled(options.allowStress);
  const runId = validateRunId(String(options.runId || env.SECURITY_PROBE_RUN_ID || defaultRunId()));
  const outDir = resolve(repoRoot, String(options.outDir || 'my-docs/evidence/security-audit'));

  return {
    apiUrl,
    webUrl,
    wsUrl: apiUrl.replace(/^http/, 'ws'),
    target,
    mode: target === 'local' ? 'local-active' : 'safe',
    allowWrite,
    allowStress,
    quick: optionEnabled(options.quick),
    probe: options.probe ? String(options.probe) : null,
    failOn: options.failOn ? String(options.failOn) : 'high',
    recordVerifications:
      env.CI === 'true'
        ? !optionDisabled(options.noRecordVerifications)
        : optionEnabled(options.recordVerifications),
    maxBurst: Number(options.maxBurst || 20),
    maxPayloadMb: Number(options.maxPayloadMb || 11),
    runId,
    outDir,
    adminEmail: String(options.adminEmail || env.SECURITY_PROBE_ADMIN_EMAIL || env.SECURITY_PROBE_EMAIL || 'dev@ship.local'),
    adminPassword: String(options.adminPassword || env.SECURITY_PROBE_ADMIN_PASSWORD || env.SECURITY_PROBE_PASSWORD || 'admin123'),
    memberEmail: String(options.memberEmail || env.SECURITY_PROBE_MEMBER_EMAIL || 'bob.martinez@ship.local'),
    memberPassword: String(options.memberPassword || env.SECURITY_PROBE_MEMBER_PASSWORD || 'admin123'),
  };
}
