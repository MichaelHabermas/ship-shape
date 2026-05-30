#!/usr/bin/env node
// Runs FleetGraph proof gates and renders the static reviewer evidence packet.
import { mkdir, writeFile, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { buildProofPacket } from './proof-model.mjs';
import { renderHtml } from './render-html.mjs';
import { renderMarkdown } from './render-markdown.mjs';
import { redactProofValue } from './redact.mjs';
import { parseArgs, runCommand, proofTestDatabaseUrl } from './proof-commands.mjs';
import {
  gitInfo,
  readGoldenCaseIndex,
  readExecutableGoldenCaseIds,
  readJsonIfExists,
  timestampForPath,
} from './proof-git.mjs';
import {
  artifactPlan,
  deployedDatabaseEvidence,
  environmentChecks,
  shouldPublishPublicProof,
} from './proof-deployed-evidence.mjs';
import { outputRoot, publicProofRoot, repoRoot, runsRoot } from './proof-repo.mjs';

const apiRequire = createRequire(path.join(repoRoot, 'api/package.json'));
const { config: loadEnv } = apiRequire('dotenv');

loadEnv({ path: path.join(repoRoot, 'api/.env.local') });
loadEnv({ path: path.join(repoRoot, 'api/.env') });

export {
  artifactPlan,
  shouldPublishPublicProof,
  summarizeDeployedEvidence,
  summarizeTraceEvidence,
  traceUrlFromMetadata,
} from './proof-deployed-evidence.mjs';

if (isMainModule()) {
  await main();
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const generatedAt = new Date();
  const runId = `fleetgraph-proof-${timestampForPath(generatedAt)}`;
  const runDir = path.join(runsRoot, runId);

  await mkdir(runDir, { recursive: true });

  const commandResults = [];
  if (!options.noRefreshEvals) {
    commandResults.push(runCommand('product surface eval', ['pnpm', 'fleetgraph:eval:surface']));
  }
  if (!options.skipTests) {
    commandResults.push(runCommand('shared package build', ['pnpm', 'build:shared']));
    commandResults.push(runCommand('FleetGraph proof tests', [
      'pnpm',
      '--filter',
      '@ship/api',
      'test',
      'src/fleetgraph/eval/eval.test.ts',
      'src/fleetgraph/eval/executable-golden-cases.test.ts',
      'src/fleetgraph/eval/product-surface.test.ts',
      'src/fleetgraph/api-contract.test.ts',
    ], {
      DATABASE_URL: proofTestDatabaseUrl(),
    }));
  }
  if (options.withE2e) {
    commandResults.push(runCommand('FleetGraph attention loop E2E', [
      'pnpm',
      'test:e2e:run',
      'e2e/fleetgraph-attention-loop.spec.ts',
    ]));
  } else {
    commandResults.push({
      name: 'FleetGraph attention loop E2E',
      command: 'pnpm test:e2e:run e2e/fleetgraph-attention-loop.spec.ts',
      status: 'skipped',
      durationMs: 0,
      note: 'Skipped by default; pass --with-e2e to run the focused browser proof.',
    });
  }

  const proofTestsPassed = commandResults.some((result) =>
    result.name === 'FleetGraph proof tests' && result.status === 'pass'
  );
  const e2ePassed = commandResults.some((result) =>
    result.name === 'FleetGraph attention loop E2E' && result.status === 'pass'
  );
  const environments = await environmentChecks(options);
  const deployedEvidence = await deployedDatabaseEvidence(options);

  const packet = redactProofValue(buildProofPacket({
    generatedAt: generatedAt.toISOString(),
    runId,
    target: options.mode,
    git: gitInfo(),
    goldenCaseIndex: await readGoldenCaseIndex(),
    executedCaseIds: proofTestsPassed ? await readExecutableGoldenCaseIds() : new Set(),
    executedScenarioIds: e2ePassed ? new Set(['context-chat-human-gate', 'source-condition-resolved']) : new Set(),
    productSurface: await readJsonIfExists(path.join(repoRoot, 'my-docs/evals/fleetgraph-product-surface/latest.json')),
    environments,
    deployedEvidence,
    commandResults,
    artifacts: artifactPlan(runId, options.mode),
  }));

  const json = `${JSON.stringify(packet, null, 2)}\n`;
  const latestHtml = renderHtml(packet, { artifactBase: '../../../' });
  const runHtml = renderHtml(packet, { artifactBase: '../../../../../' });
  const markdown = renderMarkdown(packet);

  await writeFile(path.join(runDir, 'proof.json'), json);
  await writeFile(path.join(runDir, 'proof.html'), runHtml);
  await writeFile(path.join(runDir, 'proof.md'), markdown);
  await writeFile(path.join(outputRoot, 'latest.json'), json);
  await writeFile(path.join(outputRoot, 'latest.html'), latestHtml);
  await writeFile(path.join(outputRoot, 'latest.md'), markdown);
  if (shouldPublishPublicProof(packet)) {
    await mkdir(publicProofRoot, { recursive: true });
    await writeFile(path.join(publicProofRoot, 'latest.json'), json);
    await writeFile(path.join(publicProofRoot, 'latest.html'), latestHtml);
    await writeFile(path.join(publicProofRoot, 'latest.md'), markdown);
  }
  await copyFile(path.join(runDir, 'proof.json'), path.join(runDir, 'manifest.json'));

  console.log(`FleetGraph proof ${packet.verdict}: ${path.relative(repoRoot, path.join(outputRoot, 'latest.html'))}`);
  if (packet.risks.length) {
    console.log('Risks:');
    for (const risk of packet.risks) console.log(`- ${risk}`);
  }
  process.exitCode = packet.verdict === 'pass' ? 0 : 1;
}

function isMainModule() {
  return process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
}
