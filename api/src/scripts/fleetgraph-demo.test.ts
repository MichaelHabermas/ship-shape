import { describe, expect, it } from 'vitest';
import { pool } from '../db/client.js';
import { runFleetGraphWorkerTick } from '../fleetgraph/execution/worker.js';
import { seedFleetGraphDemo } from './fleetgraph-demo.js';

describe('FleetGraph demo seed', () => {
  it('creates stable mixed-signal demo fixtures that survive worker repair scans', async () => {
    const report = await seedFleetGraphDemo();

    expect(report.stableFixtures.issueCount).toBeGreaterThanOrEqual(38);
    expect(report.stableFixtures.findingCount).toBeGreaterThanOrEqual(48);

    const before = await pool.query<{ signal_type: string; count: string }>(
      `SELECT run_metadata->>'signalType' AS signal_type, COUNT(*)::text AS count
         FROM fleetgraph_findings
        WHERE workspace_id = $1
          AND status = 'open'
          AND COALESCE((run_metadata->>'demo_fixture')::boolean, false) = true
        GROUP BY run_metadata->>'signalType'`,
      [report.workspaceId]
    );
    const beforeCounts = Object.fromEntries(before.rows.map((row) => [row.signal_type, Number(row.count)]));
    expect(beforeCounts.blocked).toBeGreaterThanOrEqual(14);
    expect(beforeCounts.stale).toBeGreaterThanOrEqual(14);
    expect(beforeCounts.at_risk).toBeGreaterThanOrEqual(14);

    await runFleetGraphWorkerTick({
      workspaceIds: [report.workspaceId],
      config: {
        workerEnabled: true,
        workerIntervalMs: 120_000,
        workerWorkspaceLimit: 1,
        workerCandidateLimit: 100,
        workerTickDeadlineMs: 30_000,
      },
    });

    const after = await pool.query<{ closed_count: string }>(
      `SELECT COUNT(*)::text AS closed_count
         FROM fleetgraph_findings
        WHERE workspace_id = $1
          AND COALESCE((run_metadata->>'demo_fixture')::boolean, false) = true
          AND status <> 'open'`,
      [report.workspaceId]
    );
    expect(Number(after.rows[0]?.closed_count ?? 0)).toBe(0);
  });
});
