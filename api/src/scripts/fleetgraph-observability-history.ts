// Syncs FleetGraph observability history from Langfuse and LangSmith into a deployable dashboard snapshot.
import { mkdir, writeFile } from 'fs/promises';
import { config as loadEnv } from 'dotenv';
import path, { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { Client } from 'langsmith';

type ProviderName = 'langfuse' | 'langsmith';

type ProviderHistoryTrace = {
  provider: ProviderName;
  id: string;
  name: string;
  startedAt: string | null;
  url: string | null;
  tokens: number | null;
  costUsd: number | null;
  latencyMs: number | null;
  status: 'success' | 'error' | 'unknown';
  scores: Record<string, number>;
};

type ProviderHistory = {
  ok: boolean;
  fetchedAt: string;
  source: string;
  error: string | null;
  traces: ProviderHistoryTrace[];
  totals: {
    traces: number;
    tokens: number | null;
    costUsd: number | null;
    errors: number;
  };
};

type HistorySnapshot = {
  generatedAt: string;
  windowDays: number;
  limit: number;
  providers: Record<ProviderName, ProviderHistory>;
  cumulative: {
    traces: number;
    tokens: number | null;
    costUsd: number | null;
    errors: number;
  };
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = path.resolve(process.cwd(), '..');
const reportRoot = path.join(repoRoot, 'my-docs/evals/fleetgraph-observability');
const outputPath = path.join(reportRoot, 'provider-history.json');

loadEnv({ path: join(__dirname, '../../.env.local') });
loadEnv({ path: join(__dirname, '../../.env') });

async function main(): Promise<void> {
  const limit = boundedNumber(argValue('--limit') ?? process.env.FLEETGRAPH_OBSERVABILITY_HISTORY_LIMIT, 100, 1, 500);
  const windowDays = boundedNumber(argValue('--days') ?? process.env.FLEETGRAPH_OBSERVABILITY_HISTORY_DAYS, 7, 1, 90);
  const providers = providerSelection(argValue('--providers') ?? 'both');

  const [langfuse, langsmith] = await Promise.all([
    providers.includes('langfuse') ? syncLangfuse({ limit, windowDays }) : skippedProvider('langfuse'),
    providers.includes('langsmith') ? syncLangSmith({ limit, windowDays }) : skippedProvider('langsmith'),
  ]);

  const snapshot: HistorySnapshot = {
    generatedAt: new Date().toISOString(),
    windowDays,
    limit,
    providers: { langfuse, langsmith },
    cumulative: cumulativeTotals([langfuse, langsmith]),
  };

  await mkdir(reportRoot, { recursive: true });
  await writeFile(outputPath, JSON.stringify(snapshot, null, 2));
  console.log(JSON.stringify({
    ok: true,
    outputPath,
    cumulative: snapshot.cumulative,
    providers: Object.fromEntries(Object.entries(snapshot.providers).map(([name, history]) => [
      name,
      { ok: history.ok, traces: history.totals.traces, error: history.error },
    ])),
  }, null, 2));
}

async function syncLangSmith(options: { limit: number; windowDays: number }): Promise<ProviderHistory> {
  const fetchedAt = new Date().toISOString();
  try {
    const projectName = process.env.LANGSMITH_PROJECT?.trim() || process.env.LANGCHAIN_PROJECT?.trim() || 'default';
    const client = new Client({ autoBatchTracing: false });
    const traces: ProviderHistoryTrace[] = [];
    const runs = client.listRuns({
      projectName,
      isRoot: true,
      startTime: new Date(Date.now() - options.windowDays * 24 * 60 * 60 * 1000),
      limit: options.limit,
      order: 'desc',
    });

    for await (const run of runs) {
      if (!isFleetGraphName(String(run.name ?? ''))) continue;
      traces.push({
        provider: 'langsmith',
        id: String(run.id),
        name: String(run.name ?? 'unknown'),
        startedAt: isoOrNull(run.start_time),
        url: run.app_path ? `https://smith.langchain.com${run.app_path}` : `https://smith.langchain.com/r/${run.id}`,
        tokens: numberOrNull(run.total_tokens),
        costUsd: langSmithCost(run as unknown as Record<string, unknown>),
        latencyMs: latencyMs(run.start_time, run.end_time),
        status: run.error ? 'error' : run.status === 'success' ? 'success' : 'unknown',
        scores: feedbackScores(run.feedback_stats),
      });
      if (traces.length >= options.limit) break;
    }

    return providerHistory({
      provider: 'langsmith',
      fetchedAt,
      source: projectName,
      traces,
    });
  } catch (error) {
    return providerErrorHistory('langsmith', fetchedAt, error);
  }
}

async function syncLangfuse(options: { limit: number; windowDays: number }): Promise<ProviderHistory> {
  const fetchedAt = new Date().toISOString();
  try {
    const baseUrl = process.env.LANGFUSE_BASE_URL || 'https://us.cloud.langfuse.com';
    const url = new URL('/api/public/traces', baseUrl);
    url.searchParams.set('limit', String(options.limit));
    url.searchParams.set('fromTimestamp', new Date(Date.now() - options.windowDays * 24 * 60 * 60 * 1000).toISOString());
    const response = await fetch(url, {
      headers: {
        Authorization: `Basic ${Buffer.from(`${requiredEnv('LANGFUSE_PUBLIC_KEY')}:${requiredEnv('LANGFUSE_SECRET_KEY')}`).toString('base64')}`,
      },
    }).then(async (result) => {
      if (!result.ok) throw new Error(`Langfuse traces request failed: ${result.status} ${await result.text()}`);
      return result.json();
    });
    const data = Array.isArray((response as { data?: unknown }).data)
      ? (response as { data: unknown[] }).data
      : Array.isArray(response)
        ? response
        : [];
    const traces = data
      .filter((trace) => isFleetGraphName(String(readField(trace, 'name') ?? '')))
      .slice(0, options.limit)
      .map(langfuseTrace);

    return providerHistory({
      provider: 'langfuse',
      fetchedAt,
      source: baseUrl,
      traces,
    });
  } catch (error) {
    return providerErrorHistory('langfuse', fetchedAt, error);
  }
}

function langfuseTrace(trace: unknown): ProviderHistoryTrace {
  const id = String(readField(trace, 'id') ?? readField(trace, 'traceId') ?? 'unknown');
  const baseUrl = process.env.LANGFUSE_BASE_URL || 'https://us.cloud.langfuse.com';
  const projectId = String(readField(trace, 'projectId') ?? process.env.LANGFUSE_PROJECT_ID ?? '').trim();
  const url = projectId ? `${baseUrl}/project/${projectId}/traces/${id}` : null;
  return {
    provider: 'langfuse',
    id,
    name: String(readField(trace, 'name') ?? 'unknown'),
    startedAt: isoOrNull(readField(trace, 'timestamp') ?? readField(trace, 'createdAt')),
    url,
    tokens: numberOrNull(readField(trace, 'totalTokens') ?? readField(trace, 'usage')),
    costUsd: numberOrNull(readField(trace, 'totalCost') ?? readField(trace, 'cost')),
    latencyMs: numberOrNull(readField(trace, 'latencyMs') ?? readField(trace, 'latency')),
    status: readField(trace, 'error') ? 'error' : 'unknown',
    scores: scoresObject(readField(trace, 'scores')),
  };
}

function providerHistory(input: {
  provider: ProviderName;
  fetchedAt: string;
  source: string;
  traces: ProviderHistoryTrace[];
}): ProviderHistory {
  return {
    ok: true,
    fetchedAt: input.fetchedAt,
    source: input.source,
    error: null,
    traces: input.traces,
    totals: {
      traces: input.traces.length,
      tokens: sumNullable(input.traces.map((trace) => trace.tokens)),
      costUsd: roundMoney(sumNullable(input.traces.map((trace) => trace.costUsd))),
      errors: input.traces.filter((trace) => trace.status === 'error').length,
    },
  };
}

function providerErrorHistory(provider: ProviderName, fetchedAt: string, error: unknown): ProviderHistory {
  return {
    ok: false,
    fetchedAt,
    source: provider,
    error: error instanceof Error ? error.message : String(error),
    traces: [],
    totals: { traces: 0, tokens: null, costUsd: null, errors: 0 },
  };
}

function skippedProvider(provider: ProviderName): ProviderHistory {
  return {
    ok: true,
    fetchedAt: new Date().toISOString(),
    source: provider,
    error: 'Skipped by --providers.',
    traces: [],
    totals: { traces: 0, tokens: null, costUsd: null, errors: 0 },
  };
}

function cumulativeTotals(histories: ProviderHistory[]): HistorySnapshot['cumulative'] {
  return {
    traces: histories.reduce((total, history) => total + history.totals.traces, 0),
    tokens: sumNullable(histories.map((history) => history.totals.tokens)),
    costUsd: roundMoney(sumNullable(histories.map((history) => history.totals.costUsd))),
    errors: histories.reduce((total, history) => total + history.totals.errors, 0),
  };
}

function providerSelection(value: string): ProviderName[] {
  if (value === 'both') return ['langfuse', 'langsmith'];
  if (value === 'langfuse' || value === 'langsmith') return [value];
  throw new Error(`Invalid --providers value "${value}". Use both, langfuse, or langsmith.`);
}

function argValue(name: string): string | undefined {
  const prefix = `${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function boundedNumber(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for provider history sync.`);
  return value;
}

function isFleetGraphName(name: string): boolean {
  return name.toLowerCase().includes('fleetgraph');
}

function readField(value: unknown, field: string): unknown {
  return value && typeof value === 'object' && field in value
    ? (value as Record<string, unknown>)[field]
    : undefined;
}

function numberOrNull(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function sumNullable(values: Array<number | null>): number | null {
  const numbers = values.filter((value): value is number => typeof value === 'number');
  return numbers.length > 0 ? numbers.reduce((total, value) => total + value, 0) : null;
}

function roundMoney(value: number | null): number | null {
  return value === null ? null : Number(value.toFixed(8));
}

function isoOrNull(value: unknown): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function latencyMs(start: unknown, end: unknown): number | null {
  const startedAt = start ? new Date(String(start)).getTime() : NaN;
  const endedAt = end ? new Date(String(end)).getTime() : NaN;
  return Number.isFinite(startedAt) && Number.isFinite(endedAt) ? endedAt - startedAt : null;
}

function langSmithCost(run: Record<string, unknown>): number | null {
  const direct = numberOrNull(run.total_cost ?? run.totalCost);
  if (direct !== null) return direct;
  const extra = readField(run, 'extra');
  const metadata = readField(extra, 'metadata');
  return numberOrNull(readField(metadata, 'estimatedCostUsd'));
}

function feedbackScores(feedbackStats: unknown): Record<string, number> {
  if (!feedbackStats || typeof feedbackStats !== 'object') return {};
  return Object.fromEntries(Object.entries(feedbackStats as Record<string, unknown>).flatMap(([name, value]) => {
    if (typeof value === 'number') return [[name, value]];
    const score = numberOrNull(readField(value, 'avg') ?? readField(value, 'score') ?? readField(value, 'value'));
    return score === null ? [] : [[name, score]];
  }));
}

function scoresObject(scores: unknown): Record<string, number> {
  if (!Array.isArray(scores)) return {};
  return Object.fromEntries(scores.flatMap((score) => {
    const name = readField(score, 'name');
    const value = numberOrNull(readField(score, 'value'));
    return typeof name === 'string' && value !== null ? [[name, value]] : [];
  }));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
