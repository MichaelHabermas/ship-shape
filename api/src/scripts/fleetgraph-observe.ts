// Runs the local FleetGraph dual-provider observability trial and writes comparison reports.
import { randomUUID } from 'crypto';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { config as loadEnv } from 'dotenv';
import path, { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { pool } from '../db/client.js';
import {
  scoreFleetGraphObservabilityResult,
  summarizeFleetGraphObservabilityScores,
  type FleetGraphObservabilityScore,
} from '../fleetgraph/observability-scores.js';
import { postFleetGraphTraceScores, shutdownFleetGraphTracing, withFleetGraphTrace } from '../fleetgraph/observability-trace.js';
import type { FleetGraphTraceProviderEvidence } from '../fleetgraph/observability-trace.js';
import type { FleetGraphResult } from '../fleetgraph/types.js';
import { seedFleetGraphDemo, type FleetGraphDemoReport } from './fleetgraph-demo.js';

type ProviderSelection = 'both' | 'langfuse' | 'langsmith';

type ObserveOptions = {
  maxRuns: number;
  noModel: boolean;
  providers: ProviderSelection;
  reportJson: boolean;
  reportMd: boolean;
};

type ObservedTrace = {
  label: string;
  decision: string;
  traceId: string;
  traceUrl: string;
  sharedTraceUrl: string | null;
  providers: FleetGraphTraceProviderEvidence[];
  providerFailures: string[];
  scorePostFailures: string[];
  scores: FleetGraphObservabilityScore[];
  tokenMetadata: FleetGraphResult['tokenMetadata'];
  costMetadata: FleetGraphResult['costMetadata'];
};

type ObservabilityDatasetItem = {
  id: string;
  addedAt: string;
  sourceRunGeneratedAt: string;
  label: string;
  decision: string;
  reason: 'failed_score' | 'provider_failure' | 'model_cost' | 'manual_review';
  failedScores: string[];
  providerFailures: string[];
  tokenMetadata: FleetGraphResult['tokenMetadata'];
  costMetadata: FleetGraphResult['costMetadata'];
  providers: FleetGraphTraceProviderEvidence[];
  expectedScores: Record<string, number>;
  reportPath: string;
};

type ObserveReport = {
  generatedAt: string;
  options: ObserveOptions;
  summary: {
    traceCount: number;
    modelCalls: number;
    totalTokens: number;
    estimatedCostUsd: number;
    scoreSummary: ReturnType<typeof summarizeFleetGraphObservabilityScores>;
  };
  traces: ObservedTrace[];
  datasetItems: ObservabilityDatasetItem[];
  demo: FleetGraphDemoReport | null;
  winnerSignals: string[];
  providerFeatureCoverage: Record<string, string>;
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = path.resolve(process.cwd(), '..');
const reportRoot = path.join(repoRoot, 'my-docs/evals/fleetgraph-observability');
const datasetRoot = path.join(reportRoot, 'datasets');
const datasetIndexPath = path.join(datasetRoot, 'edge-cases.json');

loadEnv({ path: join(__dirname, '../../.env.local') });
loadEnv({ path: join(__dirname, '../../.env') });

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  configureProviderSelection(options.providers);
  configureModelSpend(options.noModel);

  const traces: ObservedTrace[] = [];
  traces.push(await runSmokeObservation());

  let demo: FleetGraphDemoReport | null = null;
  if (options.maxRuns > 1) {
    demo = await seedFleetGraphDemo({ captureTraces: true });
    traces.push(...demoTraceEvidence(demo).slice(0, Math.max(0, options.maxRuns - traces.length)));
  }

  const report = await buildReport({
    options,
    traces: traces.slice(0, options.maxRuns),
    demo,
  });
  const paths = await writeReports(report, options);
  await shutdownFleetGraphTracing();

  console.log(JSON.stringify({
    ok: true,
    traceCount: report.summary.traceCount,
    modelCalls: report.summary.modelCalls,
    totalTokens: report.summary.totalTokens,
    estimatedCostUsd: report.summary.estimatedCostUsd,
    reports: paths,
    traces: report.traces.map((trace) => ({
      label: trace.label,
      decision: trace.decision,
      traceUrl: trace.traceUrl,
      providers: trace.providers,
      failedScores: trace.scores.filter((score) => !score.passed).map((score) => score.name),
      providerFailures: [...trace.providerFailures, ...trace.scorePostFailures],
    })),
  }, null, 2));
}

function parseOptions(args: string[]): ObserveOptions {
  const maxRunsArg = valueArg(args, '--max-runs');
  const maxRuns = Math.min(10, Math.max(1, Number(maxRunsArg ?? process.env.FLEETGRAPH_OBSERVABILITY_MAX_RUNS ?? 5)));
  const providers = providerArg(valueArg(args, '--providers') ?? 'both');
  return {
    maxRuns: Number.isFinite(maxRuns) ? maxRuns : 5,
    noModel: args.includes('--no-model'),
    providers,
    reportJson: args.includes('--report-json') || !args.includes('--report-md'),
    reportMd: args.includes('--report-md') || !args.includes('--report-json'),
  };
}

function valueArg(args: string[], name: string): string | undefined {
  const prefix = `${name}=`;
  const inline = args.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function providerArg(value: string): ProviderSelection {
  if (value === 'both' || value === 'langfuse' || value === 'langsmith') return value;
  throw new Error(`Invalid --providers value "${value}". Use both, langfuse, or langsmith.`);
}

function configureProviderSelection(providers: ProviderSelection): void {
  if (providers === 'langfuse') {
    process.env.LANGSMITH_TRACING = '0';
    process.env.LANGCHAIN_TRACING_V2 = '0';
  }
  if (providers === 'langsmith') {
    delete process.env.LANGFUSE_TRACING;
    delete process.env.LANGFUSE_PUBLIC_KEY;
    delete process.env.LANGFUSE_SECRET_KEY;
  }
}

function configureModelSpend(noModel: boolean): void {
  process.env.FLEETGRAPH_REAL_MODEL_ENABLED = noModel ? 'false' : 'true';
  process.env.FLEETGRAPH_MODEL_INPUT_COST_PER_1M ??= '0.15';
  process.env.FLEETGRAPH_MODEL_OUTPUT_COST_PER_1M ??= '0.60';
}

async function runSmokeObservation(): Promise<ObservedTrace> {
  const label = `fleetgraph-observe-smoke-${randomUUID().slice(0, 8)}`;
  const capture = await withFleetGraphTrace({
    name: 'fleetgraph.observe_smoke',
    inputs: {
      label,
      note: 'Observability trial quiet-exit smoke. No model call.',
    },
  }, async (trace) => smokeResult(trace.traceId, trace.traceUrl));
  const scores = scoreFleetGraphObservabilityResult(capture.result);
  const scorePostFailures = await postFleetGraphTraceScores({
    providers: capture.providers,
    scores,
  });

  return {
    label,
    decision: capture.result.decision,
    traceId: capture.traceId,
    traceUrl: capture.traceUrl,
    sharedTraceUrl: capture.sharedTraceUrl,
    providers: capture.providers,
    providerFailures: capture.providerFailures,
    scorePostFailures,
    scores,
    tokenMetadata: capture.result.tokenMetadata,
    costMetadata: capture.result.costMetadata,
  };
}

function demoTraceEvidence(demo: FleetGraphDemoReport): ObservedTrace[] {
  const evidence = demo.traceEvidence;
  if (!evidence) return [];
  const traceItems = [
    { label: 'proactive_create', trace: evidence.proactive },
    { label: 'explain', trace: evidence.explain },
    { label: 'refine', trace: evidence.refine },
  ];
  return traceItems.map(({ label, trace }) => ({
    label,
    decision: trace.decision,
    traceId: trace.traceId,
    traceUrl: trace.traceUrl,
    sharedTraceUrl: trace.sharedTraceUrl,
    providers: trace.providers,
    providerFailures: trace.providerFailures,
    scorePostFailures: trace.scorePostFailures,
    scores: trace.observabilityScores,
    tokenMetadata: trace.tokenMetadata,
    costMetadata: trace.costMetadata,
  }));
}

async function buildReport(input: {
  options: ObserveOptions;
  traces: ObservedTrace[];
  demo: FleetGraphDemoReport | null;
}): Promise<ObserveReport> {
  const allScores = input.traces.flatMap((trace) => trace.scores);
  const modelCalls = input.traces.reduce((total, trace) => total + trace.tokenMetadata.modelCalls, 0);
  const totalTokens = input.traces.reduce((total, trace) => total + (trace.tokenMetadata.totalTokens ?? 0), 0);
  const estimatedCostUsd = input.traces.reduce((total, trace) => total + (trace.costMetadata.estimatedCostUsd ?? 0), 0);
  const generatedAt = new Date().toISOString();
  const datasetItems = datasetItemsForRun({
    generatedAt,
    traces: input.traces,
  });

  return {
    generatedAt,
    options: input.options,
    summary: {
      traceCount: input.traces.length,
      modelCalls,
      totalTokens,
      estimatedCostUsd: Number(estimatedCostUsd.toFixed(8)),
      scoreSummary: summarizeFleetGraphObservabilityScores(allScores),
    },
    traces: input.traces,
    datasetItems,
    demo: input.demo,
    winnerSignals: winnerSignals(input.traces),
    providerFeatureCoverage: {
      langfuse: 'Native traces, native trace scores, generation usage/cost observations, datasets/experiments/prompt APIs available for the next trial step.',
      langsmith: 'Native runs, native feedback scores, shared trace URLs when share succeeds, annotation queues/datasets/evaluators available for the next trial step.',
      local: 'Canonical deterministic evaluator output, cost/token rollup, and side-by-side provider failure accounting.',
    },
  };
}

async function writeReports(report: ObserveReport, options: ObserveOptions): Promise<string[]> {
  await mkdir(reportRoot, { recursive: true });
  const stamp = report.generatedAt.replace(/[:.]/g, '-');
  const paths: string[] = [];

  if (options.reportJson) {
    const jsonPath = path.join(reportRoot, `run-${stamp}.json`);
    await writeFile(jsonPath, JSON.stringify(report, null, 2));
    paths.push(jsonPath);
  }
  if (options.reportMd) {
    const mdPath = path.join(reportRoot, `run-${stamp}.md`);
    await writeFile(mdPath, markdownReport(report));
    paths.push(mdPath);
  }
  if (report.datasetItems.length > 0) {
    paths.push(...await appendDatasetItems(report.datasetItems, paths[0] ?? path.join(reportRoot, `run-${stamp}.json`)));
  }

  return paths;
}

function markdownReport(report: ObserveReport): string {
  return [
    '# FleetGraph Observability Trial',
    '',
    `Generated: ${report.generatedAt}`,
    '',
    '## Summary',
    '',
    `- Traces: ${report.summary.traceCount}`,
    `- Model calls: ${report.summary.modelCalls}`,
    `- Total tokens: ${report.summary.totalTokens}`,
    `- Estimated cost USD: ${report.summary.estimatedCostUsd}`,
    `- Score pass/fail: ${report.summary.scoreSummary.passed}/${report.summary.scoreSummary.failed}`,
    `- Dataset items added: ${report.datasetItems.length}`,
    '',
    '## Provider Coverage',
    '',
    ...Object.entries(report.providerFeatureCoverage).map(([provider, note]) => `- ${provider}: ${note}`),
    '',
    '## Winner Signals',
    '',
    ...report.winnerSignals.map((signal) => `- ${signal}`),
    '',
    '## Traces',
    '',
    '| Label | Decision | Tokens | Cost | Failed scores | Provider failures | URLs |',
    '| --- | --- | ---: | ---: | --- | --- | --- |',
    ...report.traces.map((trace) => [
      trace.label,
      trace.decision,
      String(trace.tokenMetadata.totalTokens ?? 0),
      String(trace.costMetadata.estimatedCostUsd ?? 0),
      trace.scores.filter((score) => !score.passed).map((score) => score.name).join(', ') || 'none',
      [...trace.providerFailures, ...trace.scorePostFailures].join('; ') || 'none',
      trace.providers.map((provider) => `${provider.provider}: ${provider.sharedTraceUrl ?? provider.traceUrl}`).join('<br>'),
    ].map(markdownCell).join(' | ')).map((row) => `| ${row} |`),
    '',
    '## Dataset Items',
    '',
    report.datasetItems.length > 0
      ? '| ID | Reason | Label | Expected failed scores | Provider failures | |\n| --- | --- | --- | --- | --- | |\n' + report.datasetItems.map((item) =>
        `| ${item.id} | ${item.reason} | ${markdownCell(item.label)} | ${item.failedScores.join(', ') || 'none'} | ${item.providerFailures.join('; ') || 'none'} | |`
      ).join('\n')
      : 'No edge-case dataset items added on this run.',
    '',
    '## Score Detail',
    '',
    ...report.traces.flatMap((trace) => [
      `### ${trace.label}`,
      '',
      '| Score | Value | Comment |',
      '| --- | ---: | --- |',
      ...trace.scores.map((score) => `| ${score.name} | ${score.value} | ${markdownCell(score.comment)} |`),
      '',
    ]),
  ].join('\n');
}

function datasetItemsForRun(input: {
  generatedAt: string;
  traces: readonly ObservedTrace[];
}): ObservabilityDatasetItem[] {
  return input.traces.flatMap((trace) => {
    const failedScores = trace.scores.filter((score) => !score.passed).map((score) => score.name);
    const providerFailures = [...trace.providerFailures, ...trace.scorePostFailures];
    const reasons: ObservabilityDatasetItem['reason'][] = [];
    if (failedScores.length > 0) reasons.push('failed_score');
    if (providerFailures.length > 0) reasons.push('provider_failure');
    if ((trace.costMetadata.estimatedCostUsd ?? 0) > 0 || trace.tokenMetadata.modelCalls > 0) reasons.push('model_cost');

    return reasons.map((reason) => ({
      id: `${input.generatedAt}:${trace.label}:${reason}`.replace(/[^a-zA-Z0-9_.:-]/g, '_'),
      addedAt: new Date().toISOString(),
      sourceRunGeneratedAt: input.generatedAt,
      label: trace.label,
      decision: trace.decision,
      reason,
      failedScores,
      providerFailures,
      tokenMetadata: trace.tokenMetadata,
      costMetadata: trace.costMetadata,
      providers: trace.providers,
      expectedScores: Object.fromEntries(trace.scores.map((score) => [score.name, score.value])),
      reportPath: '',
    }));
  });
}

async function appendDatasetItems(items: readonly ObservabilityDatasetItem[], reportPath: string): Promise<string[]> {
  await mkdir(datasetRoot, { recursive: true });
  const existing = await readDatasetIndex();
  const byId = new Map(existing.map((item) => [item.id, item]));
  for (const item of items) {
    byId.set(item.id, { ...item, reportPath });
  }
  const merged = Array.from(byId.values()).sort((a, b) => a.addedAt.localeCompare(b.addedAt));
  await writeFile(datasetIndexPath, JSON.stringify(merged, null, 2));
  await writeFile(path.join(datasetRoot, 'edge-cases.md'), markdownDataset(merged));
  return [datasetIndexPath, path.join(datasetRoot, 'edge-cases.md')];
}

async function readDatasetIndex(): Promise<ObservabilityDatasetItem[]> {
  try {
    const raw = await readFile(datasetIndexPath, 'utf8');
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isDatasetItem) : [];
  } catch {
    return [];
  }
}

function markdownDataset(items: readonly ObservabilityDatasetItem[]): string {
  return [
    '# FleetGraph Observability Edge-Case Dataset',
    '',
    'This file is generated by `pnpm fleetgraph:observe`. Items here are traces worth replaying or reviewing because they failed a score, hit provider friction, or spent model cost.',
    '',
    '| Added | Reason | Label | Decision | Failed scores | Provider failures | Report |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...items.map((item) => [
      item.addedAt,
      item.reason,
      item.label,
      item.decision,
      item.failedScores.join(', ') || 'none',
      item.providerFailures.join('; ') || 'none',
      item.reportPath,
    ].map(markdownCell).join(' | ')).map((row) => `| ${row} |`),
    '',
  ].join('\n');
}

function isDatasetItem(value: unknown): value is ObservabilityDatasetItem {
  return Boolean(value) &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    typeof (value as { id?: unknown }).id === 'string' &&
    typeof (value as { label?: unknown }).label === 'string' &&
    typeof (value as { reason?: unknown }).reason === 'string';
}

function winnerSignals(traces: readonly ObservedTrace[]): string[] {
  const providerCounts = new Map<string, number>();
  const providerFailures = new Map<string, number>();
  for (const trace of traces) {
    for (const provider of trace.providers) {
      providerCounts.set(provider.provider, (providerCounts.get(provider.provider) ?? 0) + 1);
      if (provider.error) providerFailures.set(provider.provider, (providerFailures.get(provider.provider) ?? 0) + 1);
    }
  }
  return [
    `Langfuse trace coverage: ${providerCounts.get('langfuse') ?? 0}/${traces.length}.`,
    `LangSmith trace coverage: ${providerCounts.get('langsmith') ?? 0}/${traces.length}.`,
    `Langfuse provider errors: ${providerFailures.get('langfuse') ?? 0}.`,
    `LangSmith provider errors: ${providerFailures.get('langsmith') ?? 0}.`,
    'Compare dashboard ergonomics manually from the linked traces; this report intentionally records signals, not a premature winner.',
  ];
}

function markdownCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\n/g, '<br>');
}

function smokeResult(traceId: string | undefined, traceUrl: string | undefined): FleetGraphResult {
  const traceMetadata = {
    traceId,
    traceUrl,
    mode: 'proactive' as const,
    decision: 'quiet_exit' as const,
    nodePath: ['normalizeTrigger', 'observeSmoke', 'produceOutput'],
  };
  return {
    decision: 'quiet_exit',
    finding: null,
    run: {
      id: '00000000-0000-4000-8000-000000000001',
      workspace_id: '00000000-0000-4000-8000-000000000002',
      finding_id: null,
      source_issue_id: null,
      source_sprint_id: null,
      mode: 'proactive',
      trigger_reason: 'observe_smoke',
      decision: 'quiet_exit',
      dedupe_key: null,
      input_snapshot: {},
      evidence_snapshot: [],
      output_snapshot: {},
      trace_metadata: traceMetadata,
      token_metadata: { modelCalls: 0 },
      cost_metadata: {},
      error_metadata: {},
      started_at: new Date(),
      completed_at: new Date(),
      created_at: new Date(),
    },
    runInput: {
      workspaceId: '00000000-0000-4000-8000-000000000002',
      mode: 'proactive',
      triggerReason: 'observe_smoke',
      decision: 'quiet_exit',
      inputSnapshot: {},
      evidenceSnapshot: [],
      outputSnapshot: {},
      traceMetadata,
      tokenMetadata: { modelCalls: 0 },
      costMetadata: {},
      errorMetadata: {},
    },
    visibleOutput: {
      title: 'FleetGraph observe smoke',
      summary: 'No-op observability trial smoke completed.',
      evidence: [],
      humanGate: { required: false },
    },
    evidence: [],
    traceMetadata,
    tokenMetadata: { modelCalls: 0 },
    costMetadata: {},
    errorMetadata: {},
  };
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await shutdownFleetGraphTracing().catch(() => undefined);
    await pool.end().catch(() => undefined);
  });
