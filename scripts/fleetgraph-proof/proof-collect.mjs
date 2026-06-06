// Deep boundary for FleetGraph deployed proof collection (env checks + DB evidence).
import {
  applyTraceUrlOverrides,
  deployedDatabaseEvidence,
  environmentChecks,
} from './proof-deployed-evidence.mjs';

export async function collectDeployedProof(options, traceOverrides = null) {
  const environments = await environmentChecks(options);
  const deployedEvidence = applyTraceUrlOverrides(
    await deployedDatabaseEvidence(options),
    traceOverrides,
  );
  return { environments, deployedEvidence };
}

export { environmentChecks, deployedDatabaseEvidence, applyTraceUrlOverrides };
