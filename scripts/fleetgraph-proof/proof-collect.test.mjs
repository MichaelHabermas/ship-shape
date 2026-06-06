// Unit tests for FleetGraph proof collection boundary.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { collectDeployedProof } from './proof-collect.mjs';

test('collectDeployedProof returns local environment for local mode', async () => {
  const result = await collectDeployedProof({ mode: 'local' });
  assert.ok(Array.isArray(result.environments));
  assert.equal(result.environments.some((env) => env.id === 'local'), true);
  assert.equal(result.deployedEvidence, null);
});
