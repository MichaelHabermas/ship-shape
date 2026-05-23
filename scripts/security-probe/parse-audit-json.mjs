#!/usr/bin/env node
import { readFileSync } from 'node:fs';

const path = process.argv[2];
if (!path) {
  console.error('Usage: parse-audit-json.mjs <pnpm-audit.json>');
  process.exit(1);
}

let parsed;
try {
  parsed = JSON.parse(readFileSync(path, 'utf8'));
} catch (error) {
  console.error(JSON.stringify({ error: 'parse_failed', message: String(error.message || error) }));
  process.exit(1);
}

const metadata = parsed.metadata?.vulnerabilities || {};
const advisories = [];
const seen = new Set();

for (const item of Object.values(parsed.advisories || {})) {
  const key = `${item.module_name || item.name}:${item.severity}:${item.title}`;
  if (seen.has(key)) continue;
  seen.add(key);
  advisories.push({
    module: item.module_name || item.name,
    severity: item.severity,
    title: item.title,
    url: item.url,
    cves: item.cves || [],
  });
}

for (const [name, item] of Object.entries(parsed.vulnerabilities || {})) {
  const severity = item.severity;
  const via = Array.isArray(item.via) ? item.via : [];
  for (const entry of via) {
    if (typeof entry !== 'object' || !entry) continue;
    const key = `${name}:${entry.severity || severity}:${entry.title || entry.source}`;
    if (seen.has(key)) continue;
    seen.add(key);
    advisories.push({
      module: name,
      severity: entry.severity || severity,
      title: entry.title || entry.url || String(entry.source || 'advisory'),
      url: entry.url,
      cves: entry.cves || [],
    });
  }
}

const bySeverity = { info: 0, low: 0, moderate: 0, high: 0, critical: 0 };
for (const [key, value] of Object.entries(metadata)) {
  if (key in bySeverity) bySeverity[key] = value;
}

const highCritical = advisories.filter((item) => item.severity === 'high' || item.severity === 'critical');
const uniqueCves = [...new Set(advisories.flatMap((item) => item.cves).filter(Boolean))];

console.log(JSON.stringify({
  metadataVulnerabilities: bySeverity,
  highOrCriticalCount: (bySeverity.high || 0) + (bySeverity.critical || 0),
  highOrCriticalAdvisoryRows: highCritical.length,
  totalAdvisoryRows: advisories.length,
  uniqueCveIds: uniqueCves,
  uniqueCveCount: uniqueCves.length,
  highCriticalAdvisories: highCritical,
  allAdvisories: advisories,
  totalDependencies: parsed.metadata?.totalDependencies ?? null,
}, null, 2));
