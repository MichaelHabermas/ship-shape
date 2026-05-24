import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { evidenceDir, repoRoot } from '../../core/paths.mjs';

export function runComplianceCommand() {
  const deliverablePath = resolve(evidenceDir, 'cat8-audit-deliverable.json');
  const latestPath = resolve(evidenceDir, 'latest.json');

  if (!existsSync(deliverablePath)) {
    console.error(`Missing ${deliverablePath}`);
    console.error('Run: shipshape-security baseline deliverable');
    process.exit(1);
  }

  const deliverable = JSON.parse(readFileSync(deliverablePath, 'utf8'));
  const latest = existsSync(latestPath) ? JSON.parse(readFileSync(latestPath, 'utf8')) : null;

  console.log('# Category 8 compliance (Shipshape Security Audit)\n');
  console.log(`Repo: ${repoRoot}`);
  console.log(`Deliverable: ${deliverablePath}\n`);

  const rows = deliverable.table || deliverable.rows || [];
  if (rows.length) {
    console.log('| Metric | Baseline | Current |');
    console.log('|--------|----------|---------|');
    for (const row of rows) {
      const baseline =
        typeof row.baseline === 'object' ? JSON.stringify(row.baseline) : (row.baseline ?? '—');
      const current =
        typeof row.current === 'object' ? JSON.stringify(row.current) : (row.current ?? '—');
      console.log(`| ${row.metric} | ${baseline} | ${current} |`);
    }
  } else {
    console.log(JSON.stringify(deliverable, null, 2));
  }

  if (latest?.summary) {
    console.log('\n## Latest probe run\n');
    console.log(`- Run ID: ${latest.run?.id ?? '—'}`);
    console.log(
      `- Attack surfaces: ${latest.summary.attackSurfacesMeasured}/${latest.summary.attackSurfacesTotal}`
    );
    console.log(`- Findings: ${latest.summary.findings}`);
    if (latest.summary.triageCounts) {
      const t = latest.summary.triageCounts;
      console.log(`- Triage: known-open=${t.knownOpen}, new=${t.new}, resolved=${t.resolved}, regression=${t.regression}`);
    }
  } else {
    console.log('\n(No latest.json — run `shipshape-security run` first.)');
  }
}
