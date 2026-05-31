#!/usr/bin/env node
// Runs FleetGraph proof gates and renders the static reviewer evidence packet.
import { mkdir, writeFile, copyFile, readdir, readFile } from 'node:fs/promises';
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
  applyTraceUrlOverrides,
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
  publicLangSmithTraceUrl,
  applyTraceUrlOverrides,
} from './proof-deployed-evidence.mjs';

if (isMainModule()) {
  await main();
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const generatedAt = new Date();
  const runId = `fleetgraph-proof-${timestampForPath(generatedAt)}`;
  const runDir = path.join(runsRoot, runId);

  console.log(`FleetGraph proof: run ${runId} starting in ${options.mode} mode.`);
  await mkdir(runDir, { recursive: true });
  console.log(`FleetGraph proof: writing run artifacts to ${path.relative(repoRoot, runDir)}.`);

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
    commandResults.push(runCommand('API package build for E2E', ['pnpm', '--filter', '@ship/api', 'build']));
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
  console.log('FleetGraph proof: checking target environments...');
  const environments = await environmentChecks(options);
  console.log('FleetGraph proof: target environment checks complete.');
  console.log('FleetGraph proof: collecting deployed database evidence...');
  const deployedEvidence = applyTraceUrlOverrides(
    await deployedDatabaseEvidence(options),
    traceUrlOverridesFromEnv()
  );
  console.log('FleetGraph proof: deployed evidence collection complete.');

  console.log('FleetGraph proof: building reviewer proof packet...');
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
    reviewerChain: await readReviewerChain(),
    commandResults,
    artifacts: artifactPlan(runId, options.mode),
  }));

  const json = `${JSON.stringify(packet, null, 2)}\n`;
  const latestHtml = renderHtml(packet, { artifactBase: '../../../' });
  const runHtml = renderHtml(packet, { artifactBase: '../../../../../' });
  const markdown = renderMarkdown(packet);

  console.log('FleetGraph proof: writing latest and public artifacts...');
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

function traceUrlOverridesFromEnv() {
  if (!process.env.FLEETGRAPH_PROOF_TRACE_URLS_JSON) return null;
  const overrides = JSON.parse(process.env.FLEETGRAPH_PROOF_TRACE_URLS_JSON);
  console.log(`FleetGraph proof: loaded public trace URL overrides for ${Object.keys(overrides).join(', ')}.`);
  return overrides;
}

function isMainModule() {
  return process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
}

async function readReviewerChain() {
  let chain = null;
  if (process.env.FLEETGRAPH_REVIEWER_CHAIN_JSON) {
    chain = JSON.parse(process.env.FLEETGRAPH_REVIEWER_CHAIN_JSON);
  } else if (process.env.FLEETGRAPH_REVIEWER_CHAIN_PATH) {
    chain = await readJsonIfExists(path.resolve(repoRoot, process.env.FLEETGRAPH_REVIEWER_CHAIN_PATH));
  } else {
    chain = await latestCompleteReviewerChainProof();
  }
  if (!chain) return null;
  console.log(`FleetGraph proof: attached reviewer chain ${chain.chainId || 'unknown'}.`);
  return chain.steps ? publicReviewerChainProof(chain) : chain;
}

async function latestCompleteReviewerChainProof() {
  const entries = await readdir(runsRoot, { withFileTypes: true }).catch(() => []);
  const packets = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const proofPath = path.join(runsRoot, entry.name, 'proof.json');
    try {
      const packet = JSON.parse(await readFile(proofPath, 'utf8'));
      const chain = packet.reviewerChain;
      if (chain?.status !== 'complete') continue;
      if (Array.isArray(chain.missing) && chain.missing.length > 0) continue;
      packets.push({ generatedAt: stringValue(packet.generatedAt), chain });
    } catch {
      // Ignore old or partial proof run directories.
    }
  }
  packets.sort((a, b) => b.generatedAt.localeCompare(a.generatedAt));
  return packets[0]?.chain ?? null;
}

function publicReviewerChainProof(chain) {
  return {
    chainId: stringValue(chain.chainId),
    scenario: stringValue(chain.scenario),
    status: stringValue(chain.status),
    missing: Array.isArray(chain.missing) ? chain.missing.map(stringValue) : [],
    generatedAt: stringValue(chain.generatedAt),
    freshness: safeObject(chain.freshness),
    latencyMs: safeObject(chain.latencyMs),
    steps: Array.isArray(chain.steps)
      ? chain.steps.map((step) => ({
        key: stringValue(step.key),
        label: stringValue(step.label),
        status: stringValue(step.status),
        at: step.at === null ? null : stringValue(step.at),
        durationMs: numberValue(step.durationMs),
        evidence: step.status === 'pass' ? 'Reviewer-safe evidence present.' : stringValue(step.evidence),
      }))
      : [],
    humanGate: {
      required: chain.humanGate?.required === true,
      state: stringValue(chain.humanGate?.state),
      allowedActions: Array.isArray(chain.humanGate?.allowedActions)
        ? chain.humanGate.allowedActions.map(stringValue)
        : [],
    },
    traceQuality: {
      passed: chain.traceQuality?.passed === true,
      requiredDecisions: Array.isArray(chain.traceQuality?.requiredDecisions)
        ? chain.traceQuality.requiredDecisions.map(stringValue)
        : [],
      observedDecisions: Array.isArray(chain.traceQuality?.observedDecisions)
        ? chain.traceQuality.observedDecisions.map(stringValue)
        : [],
      scores: Array.isArray(chain.traceQuality?.scores)
        ? chain.traceQuality.scores.map((score) => ({
          name: stringValue(score.name),
          passed: score.passed === true,
          value: ['boolean', 'number'].includes(typeof score.value) ? score.value : null,
          comment: stringValue(score.comment),
        }))
        : [],
    },
    sourceMutationCheck: {
      passed: chain.sourceMutationCheck?.passed === true,
      before: {},
      after: {},
      changedFields: Array.isArray(chain.sourceMutationCheck?.changedFields)
        ? chain.sourceMutationCheck.changedFields.map(stringValue)
        : [],
    },
    usageSummary: safeObject(chain.usageSummary),
  };
}

function stringValue(value) {
  return typeof value === 'string' ? value : '';
}

function numberValue(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function safeObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([, item]) =>
    item === null || ['string', 'number', 'boolean'].includes(typeof item)
  ));
}
