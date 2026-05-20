import { resolve } from 'node:path';
import { notMeasured, passed } from '../lib/collector.mjs';
import { exists, readJson, repoRelative, repoRoot } from '../lib/fs-utils.mjs';

export async function collectOptionalArtifacts() {
  const artifacts = [
    {
      id: 'e2e-summary',
      path: resolve(repoRoot, 'test-results/summary.json'),
      prerequisite: 'test-results/summary.json is produced by the E2E runner.',
    },
    {
      id: 'api-benchmark',
      path: resolve(repoRoot, 'test-results/benchmarks/latest.json'),
      prerequisite: 'test-results/benchmarks/latest.json is produced by the API benchmark wrapper.',
    },
  ];

  const measured = [];
  const skipped = [];

  for (const artifact of artifacts) {
    if (await exists(artifact.path)) {
      let parsed = null;
      try {
        parsed = await readJson(artifact.path);
      } catch (error) {
        parsed = { parseError: error.message };
      }
      measured.push({
        id: artifact.id,
        path: repoRelative(artifact.path),
        parsed,
      });
    } else {
      skipped.push({
        id: artifact.id,
        path: repoRelative(artifact.path),
        status: 'not_measured',
        reason: artifact.prerequisite,
      });
    }
  }

  const data = { measured, skipped };
  const claims = [
    ...measured.map((artifact) => ({
      id: `optional.${artifact.id}`,
      status: 'met',
      statement: `${artifact.path} was captured.`,
    })),
    ...skipped.map((artifact) => ({
      id: `optional.${artifact.id}`,
      status: 'not_measured',
      statement: artifact.reason,
    })),
  ];

  if (measured.length === 0) {
    return notMeasured(
      'optional-artifacts',
      'No optional test or benchmark artifacts were present.',
      data,
      claims
    );
  }

  return passed(
    'optional-artifacts',
    `Captured ${measured.length} optional artifact(s); ${skipped.length} prerequisite(s) missing.`,
    data,
    claims
  );
}
