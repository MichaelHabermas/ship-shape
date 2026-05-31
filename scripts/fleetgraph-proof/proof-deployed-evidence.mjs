// FleetGraph proof deployed environment checks and database evidence aggregation.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { createRequire } from 'node:module';
import { defaultDeployedApiUrl, defaultDeployedWebUrl, repoRoot } from './proof-repo.mjs';
import { tail } from './proof-commands.mjs';

const apiRequire = createRequire(path.join(repoRoot, 'api/package.json'));
const pg = apiRequire('pg');

export async function environmentChecks({ mode }) {
  const environments = [];
  if (mode === 'local' || mode === 'both') {
    console.log('FleetGraph proof: local target configured.');
    environments.push({
      id: 'local',
      label: 'Local',
      required: mode !== 'deployed',
      status: 'configured',
      note: process.env.DATABASE_URL
        ? 'DATABASE_URL configured for local proof.'
        : 'Using default disposable ship_test_audit database for local FleetGraph proof tests.',
    });
  }
  if (mode === 'deployed' || mode === 'both') {
    const apiUrl = process.env.FLEETGRAPH_PROOF_API_URL ?? defaultDeployedApiUrl;
    const webUrl = process.env.FLEETGRAPH_PROOF_WEB_URL ?? defaultDeployedWebUrl;
    const databaseUrl = process.env.FLEETGRAPH_PROOF_DATABASE_URL;
    const renderPostgres = process.env.FLEETGRAPH_PROOF_RENDER_POSTGRES;
    const hasDatabaseEvidenceSource = Boolean(databaseUrl || renderPostgres);
    console.log(`FleetGraph proof: deployed target ${hasDatabaseEvidenceSource ? 'has' : 'is missing'} database evidence input.`);
    environments.push({
      id: 'deployed',
      label: 'Deployed',
      required: mode !== 'local',
      status: apiUrl && webUrl && hasDatabaseEvidenceSource ? await deployedStatus(apiUrl, webUrl) : 'blocked',
      note: apiUrl && webUrl && hasDatabaseEvidenceSource
        ? `Configured API, web, and deployed database evidence inputs${renderPostgres ? ' via Render Postgres.' : '.'}`
        : 'Set FLEETGRAPH_PROOF_RENDER_POSTGRES or FLEETGRAPH_PROOF_DATABASE_URL to include deployed database proof.',
    });
  }
  return environments;
}

export async function deployedDatabaseEvidence({ mode }) {
  if (mode === 'local') return null;
  if (process.env.FLEETGRAPH_PROOF_RENDER_POSTGRES) {
    console.log(`FleetGraph proof: reading deployed evidence from Render Postgres ${process.env.FLEETGRAPH_PROOF_RENDER_POSTGRES}.`);
    return deployedDatabaseEvidenceFromRender(process.env.FLEETGRAPH_PROOF_RENDER_POSTGRES);
  }
  const databaseUrl = process.env.FLEETGRAPH_PROOF_DATABASE_URL;
  if (!databaseUrl) return null;

  console.log('FleetGraph proof: reading deployed evidence from FLEETGRAPH_PROOF_DATABASE_URL.');
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    max: 1,
    connectionTimeoutMillis: 10_000,
    query_timeout: 15_000,
    statement_timeout: 15_000,
  });
  try {
    const [workerTicks, completedWorkerTicks, stuckTicks, eventCounts, signalRows, runRows, runEvidenceRows] = await Promise.all([
      pool.query(
        `SELECT id, status, started_at, completed_at, workspace_count, detector_decision_count, result_count, model_call_count
           FROM fleetgraph_worker_ticks
          WHERE started_at >= now() - interval '24 hours'
          ORDER BY started_at DESC
          LIMIT 5`
      ),
      pool.query(
        `SELECT id, status, started_at, completed_at, workspace_count, detector_decision_count, result_count, model_call_count
           FROM fleetgraph_worker_ticks
          WHERE started_at >= now() - interval '24 hours'
            AND status = 'completed'
          ORDER BY completed_at DESC
          LIMIT 5`
      ),
      pool.query(
        `SELECT COUNT(*)::int AS count
           FROM fleetgraph_worker_ticks
          WHERE status = 'running'
            AND deadline_at < now()`
      ),
      pool.query(
        `SELECT status, COUNT(*)::int AS count
           FROM fleetgraph_attention_events
          WHERE created_at >= now() - interval '24 hours'
          GROUP BY status
          ORDER BY status`
      ),
      pool.query(
        `SELECT COALESCE(run_metadata->>'signalType', 'blocked') AS signal_type,
                COUNT(*)::int AS count,
                MAX(updated_at) AS last_seen_at
           FROM fleetgraph_findings
          WHERE updated_at >= now() - interval '24 hours'
            AND status IN ('open', 'needs_confirmation', 'error')
          GROUP BY COALESCE(run_metadata->>'signalType', 'blocked')
          ORDER BY signal_type`
      ),
      pool.query(
        `SELECT trigger_reason,
                CASE
                  WHEN dedupe_key LIKE 'stale-issue:%' THEN 'stale'
                  WHEN dedupe_key LIKE 'at-risk-issue:%' THEN 'at_risk'
                  ELSE 'blocked'
                END AS signal_type,
                COUNT(*)::int AS count
           FROM fleetgraph_runs
          WHERE created_at >= now() - interval '24 hours'
            AND decision IN ('create_finding', 'update_finding', 'resolve', 'suppress')
          GROUP BY trigger_reason, signal_type
          ORDER BY trigger_reason, signal_type`
      ),
      pool.query(deployedRunEvidenceSql()),
    ]);
    return summarizeDeployedEvidence({
      evidenceSource: 'database-url',
      workerTicks: workerTicks.rows,
      completedWorkerTicks: completedWorkerTicks.rows,
      stuckTicks: stuckTicks.rows,
      eventCounts: eventCounts.rows,
      signalRows: signalRows.rows,
      runRows: runRows.rows,
      runEvidenceRows: runEvidenceRows.rows,
    });
  } finally {
    await pool.end();
  }
}

function deployedDatabaseEvidenceFromRender(postgresIdOrName) {
  const [workerTicks, completedWorkerTicks, stuckTicks, eventCounts, signalRows, runRows, runEvidenceRows] = [
    renderPsql(postgresIdOrName, 'recent worker ticks', `SELECT id, status, started_at, completed_at, workspace_count, detector_decision_count, result_count, model_call_count
       FROM fleetgraph_worker_ticks
      WHERE started_at >= now() - interval '24 hours'
      ORDER BY started_at DESC
      LIMIT 5`),
    renderPsql(postgresIdOrName, 'completed worker ticks', `SELECT id, status, started_at, completed_at, workspace_count, detector_decision_count, result_count, model_call_count
       FROM fleetgraph_worker_ticks
      WHERE started_at >= now() - interval '24 hours'
        AND status = 'completed'
      ORDER BY completed_at DESC
      LIMIT 5`),
    renderPsql(postgresIdOrName, 'stuck worker ticks', `SELECT COUNT(*)::int AS count
       FROM fleetgraph_worker_ticks
      WHERE status = 'running'
        AND deadline_at < now()`),
    renderPsql(postgresIdOrName, 'attention event counts', `SELECT status, COUNT(*)::int AS count
       FROM fleetgraph_attention_events
      WHERE created_at >= now() - interval '24 hours'
      GROUP BY status
      ORDER BY status`),
    renderPsql(postgresIdOrName, 'finding signal counts', `SELECT COALESCE(run_metadata->>'signalType', 'blocked') AS signal_type,
            COUNT(*)::int AS count,
            MAX(updated_at) AS last_seen_at
       FROM fleetgraph_findings
      WHERE updated_at >= now() - interval '24 hours'
        AND status IN ('open', 'needs_confirmation', 'error')
       GROUP BY COALESCE(run_metadata->>'signalType', 'blocked')
       ORDER BY signal_type`),
    renderPsql(postgresIdOrName, 'run signal counts', `SELECT trigger_reason,
            CASE
              WHEN dedupe_key LIKE 'stale-issue:%' THEN 'stale'
              WHEN dedupe_key LIKE 'at-risk-issue:%' THEN 'at_risk'
              ELSE 'blocked'
            END AS signal_type,
            COUNT(*)::int AS count
       FROM fleetgraph_runs
      WHERE created_at >= now() - interval '24 hours'
        AND decision IN ('create_finding', 'update_finding', 'resolve', 'suppress')
      GROUP BY trigger_reason, signal_type
      ORDER BY trigger_reason, signal_type`),
    renderPsql(postgresIdOrName, 'recent graph run evidence', deployedRunEvidenceSql()),
  ];
  return summarizeDeployedEvidence({
    evidenceSource: 'render-postgres',
    workerTicks,
    completedWorkerTicks,
    stuckTicks,
    eventCounts,
    signalRows,
    runRows,
    runEvidenceRows,
  });
}

export function summarizeDeployedEvidence({
  evidenceSource,
  workerTicks,
  completedWorkerTicks,
  stuckTicks,
  eventCounts,
  signalRows,
  runRows,
  runEvidenceRows = [],
}) {
  const activeRunningTickCount = workerTicks.filter((row) => row.status === 'running').length;
  const signalCounts = countSignals([...signalRows, ...runRows]);
  const scheduledWorkerSignalCounts = countSignals(
    runRows.filter((row) => row.trigger_reason === 'scheduled-worker')
  );
  const usageSummary = summarizeRunUsage(runEvidenceRows);
  const traceEvidence = summarizeTraceEvidence(runEvidenceRows);
  return {
    checkedAt: new Date().toISOString(),
    evidenceSource,
    workerTickCount: workerTicks.length,
    completedWorkerTickCount: completedWorkerTicks.length,
    hasRecentCompletedWorkerOutput: completedWorkerTicks.some(hasWorkerOutput),
    activeRunningTickCount,
    stuckRunningTickCount: Number(stuckTicks[0]?.count ?? 0),
    eventCounts: countBy(eventCounts, 'status'),
    signalTypes: deployedSignalTypes(signalCounts),
    signalCounts,
    scheduledWorkerSignalTypes: deployedSignalTypes(scheduledWorkerSignalCounts),
    scheduledWorkerSignalCounts,
    graphInvocationCount: usageSummary.graphInvocationCount,
    usageSummary,
    traceEvidence,
    recentRuns: runEvidenceRows.slice(0, 25).map(safeRunEvidenceRow),
  };
}

export function applyTraceUrlOverrides(deployedEvidence, overrides) {
  if (!deployedEvidence || !overrides) return deployedEvidence;
  const traceEvidence = deployedEvidence.traceEvidence ?? {
    requiredSignals: ['blocked', 'stale', 'at_risk', 'on_demand'],
    bySignal: {},
    missingRequired: ['blocked', 'stale', 'at_risk', 'on_demand'],
  };
  const bySignal = { ...(traceEvidence.bySignal ?? {}) };
  for (const signal of traceEvidence.requiredSignals ?? []) {
    const override = traceOverrideValue(overrides[signal]);
    if (!override) continue;
    bySignal[signal] = {
      ...(bySignal[signal] ?? {}),
      signal,
      runId: stringValue(override.runId) ?? stringValue(override.id) ?? bySignal[signal]?.runId ?? `manual-${signal}`,
      decision: stringValue(override.decision) ?? bySignal[signal]?.decision ?? 'manual_trace_override',
      triggerReason: stringValue(override.triggerReason) ?? bySignal[signal]?.triggerReason ?? 'manual-langsmith-share',
      traceUrl: publicLangSmithTraceUrl(override.traceUrl ?? override.url),
      traceId: stringValue(override.traceId) ?? bySignal[signal]?.traceId ?? null,
      createdAt: stringValue(override.createdAt) ?? bySignal[signal]?.createdAt ?? null,
    };
  }
  return {
    ...deployedEvidence,
    traceEvidence: {
      ...traceEvidence,
      bySignal,
      missingRequired: (traceEvidence.requiredSignals ?? []).filter((signal) => !bySignal[signal]?.traceUrl),
    },
  };
}

function deployedRunEvidenceSql() {
  return `SELECT id, decision, trigger_reason,
            CASE
              WHEN dedupe_key LIKE 'stale-issue:%' THEN 'stale'
              WHEN dedupe_key LIKE 'at-risk-issue:%' THEN 'at_risk'
              ELSE 'blocked'
            END AS signal_type,
            created_at,
            trace_metadata::text AS trace_metadata,
            token_metadata::text AS token_metadata,
            cost_metadata::text AS cost_metadata
       FROM fleetgraph_runs
      WHERE created_at >= now() - interval '24 hours'
      ORDER BY created_at DESC
      LIMIT 100`;
}

function summarizeRunUsage(rows) {
  const summary = {
    graphInvocationCount: rows.length,
    modelCallCount: 0,
    inputTokens: 0,
    cachedInputTokens: 0,
    billableInputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    estimatedCostUsd: 0,
    deterministicRunCount: 0,
    realModelRunCount: 0,
    costCurrency: 'USD',
    projections: {},
  };
  for (const row of rows) {
    const token = parseJsonRecord(row.token_metadata);
    const cost = parseJsonRecord(row.cost_metadata);
    const modelCalls = numberValue(token.modelCalls);
    summary.modelCallCount += modelCalls;
    summary.inputTokens += numberValue(token.inputTokens);
    summary.cachedInputTokens += numberValue(token.cachedInputTokens);
    summary.billableInputTokens += numberValue(token.billableInputTokens);
    summary.outputTokens += numberValue(token.outputTokens);
    summary.totalTokens += numberValue(token.totalTokens);
    summary.estimatedCostUsd += numberValue(cost.estimatedCostUsd ?? cost.modelCostUsd);
    if (modelCalls > 0) summary.realModelRunCount += 1;
    else summary.deterministicRunCount += 1;
  }
  summary.estimatedCostUsd = roundUsd(summary.estimatedCostUsd);
  summary.projections = usageProjections(summary);
  return summary;
}

export function summarizeTraceEvidence(rows) {
  const required = ['blocked', 'stale', 'at_risk', 'on_demand'];
  const bySignal = {};
  const bySignalDecision = {};
  for (const row of rows) {
    const signal = onDemandTraceReason(row) ? 'on_demand' : row.signal_type;
    if (!required.includes(signal)) continue;
    const trace = parseJsonRecord(row.trace_metadata);
    const link = traceUrlFromMetadata(trace);
    const evidence = {
      signal,
      runId: row.id,
      decision: row.decision,
      triggerReason: row.trigger_reason,
      traceUrl: link || null,
      traceId: stringValue(trace.traceId) || null,
      createdAt: row.created_at,
    };
    const decisionKey = `${signal}:${row.decision}`;
    if (!bySignalDecision[decisionKey]?.traceUrl && (link || !bySignalDecision[decisionKey])) {
      bySignalDecision[decisionKey] = evidence;
    }
    if (betterSignalTrace(evidence, bySignal[signal])) {
      bySignal[signal] = evidence;
    }
  }
  return {
    requiredSignals: required,
    bySignal,
    bySignalDecision,
    missingRequired: required.filter((signal) => !bySignal[signal]?.traceUrl),
  };
}

function betterSignalTrace(candidate, current) {
  if (!current) return true;
  if (!candidate.traceUrl && current.traceUrl) return false;
  if (candidate.traceUrl && !current.traceUrl) return true;
  return decisionRank(candidate.decision) > decisionRank(current.decision);
}

function decisionRank(decision) {
  switch (decision) {
    case 'create_finding':
      return 5;
    case 'explain':
    case 'needs_confirmation':
      return 4;
    case 'resolve':
    case 'suppress':
      return 3;
    case 'update_finding':
      return 2;
    case 'quiet_exit':
      return 1;
    default:
      return 0;
  }
}

function safeRunEvidenceRow(row) {
  const token = parseJsonRecord(row.token_metadata);
  const cost = parseJsonRecord(row.cost_metadata);
  const trace = parseJsonRecord(row.trace_metadata);
  return {
    id: row.id,
    decision: row.decision,
    triggerReason: row.trigger_reason,
    signalType: row.signal_type,
    createdAt: row.created_at,
    modelCalls: numberValue(token.modelCalls),
    inputTokens: numberValue(token.inputTokens),
    outputTokens: numberValue(token.outputTokens),
    totalTokens: numberValue(token.totalTokens),
    estimatedCostUsd: roundUsd(numberValue(cost.estimatedCostUsd ?? cost.modelCostUsd)),
    traceUrl: traceUrlFromMetadata(trace),
    traceId: stringValue(trace.traceId) || null,
  };
}

function onDemandTraceReason(row) {
  const value = `${row.trigger_reason ?? ''} ${row.decision ?? ''}`.toLowerCase().replace(/-/g, '_');
  return [
    'manual_run',
    'context_chat',
    'explain_finding',
    'explain',
    'refine_draft',
    'summarize_changes',
  ].some((needle) => value.includes(needle));
}

export function traceUrlFromMetadata(trace) {
  const candidate = stringValue(trace.traceUrl)
    || stringValue(trace.url)
    || stringValue(trace.observability?.url)
    || stringValue(trace.observability?.traceUrl)
    || stringValue(trace.observability?.langSmithUrl)
    || stringValue(trace.observability?.langfuseUrl)
    || stringValue(trace.langSmithUrl)
    || stringValue(trace.langfuseUrl)
    || null;
  return publicLangSmithTraceUrl(candidate);
}

export function publicLangSmithTraceUrl(candidate) {
  if (!candidate) return null;
  try {
    const url = new URL(candidate);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    if (url.hostname !== 'smith.langchain.com') return null;
    if (!url.pathname.startsWith('/public/')) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function traceOverrideValue(value) {
  if (typeof value === 'string') {
    const traceUrl = publicLangSmithTraceUrl(value);
    if (!traceUrl) throw new Error(`Trace override must be a public LangSmith URL: ${value}`);
    return { traceUrl };
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const traceUrl = publicLangSmithTraceUrl(value.traceUrl ?? value.url);
  if (!traceUrl) throw new Error(`Trace override must include a public LangSmith URL`);
  return { ...value, traceUrl };
}

function hasWorkerOutput(row) {
  return row.status === 'completed'
    && Boolean(row.completed_at)
    && (Number(row.detector_decision_count ?? 0) > 0 || Number(row.result_count ?? 0) > 0);
}

function countSignals(rows) {
  const counts = {};
  for (const row of rows) {
    if (!['blocked', 'stale', 'at_risk'].includes(row.signal_type)) continue;
    counts[row.signal_type] = (counts[row.signal_type] ?? 0) + Number(row.count ?? 0);
  }
  return counts;
}

function countBy(rows, key) {
  const counts = {};
  for (const row of rows) counts[row[key]] = Number(row.count ?? 0);
  return counts;
}

function parseJsonRecord(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function numberValue(value) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function stringValue(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function roundUsd(value) {
  return Math.round(numberValue(value) * 1_000_000) / 1_000_000;
}

function usageProjections(summary) {
  const divisor = Math.max(1, summary.graphInvocationCount);
  const costPerInvocation = summary.estimatedCostUsd / divisor;
  const tokensPerInvocation = summary.totalTokens / divisor;
  return Object.fromEntries([100, 1000, 10000].map((users) => [users, {
    assumedInvocationsPerUserPerMonth: 30,
    monthlyInvocations: users * 30,
    estimatedMonthlyCostUsd: roundUsd(costPerInvocation * users * 30),
    estimatedMonthlyTokens: Math.round(tokensPerInvocation * users * 30),
  }]));
}

function deployedSignalTypes(signalCounts) {
  const signals = new Set();
  for (const signal of Object.keys(signalCounts)) signals.add(signal);
  return [...signals].sort();
}

function renderPsql(postgresIdOrName, label, sql) {
  const started = Date.now();
  console.log(`FleetGraph proof: querying Render Postgres for ${label}...`);
  const result = spawnSync('render', [
    'psql',
    postgresIdOrName,
    '--command',
    sql,
    '--output',
    'text',
    '--',
    '--csv',
    '-q',
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 60_000,
  });
  if (result.error) {
    throw new Error(`render psql failed: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`render psql failed: ${tail(result.stderr || result.stdout, 2000)}`);
  }
  console.log(`FleetGraph proof: ${label} query complete in ${formatDuration(Date.now() - started)}.`);
  return parseCsv(result.stdout);
}

function formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function parseCsv(csv) {
  const lines = String(csv ?? '').trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const headers = splitCsvLine(lines[0]);
  return lines.slice(1).map((line) => Object.fromEntries(
    splitCsvLine(line).map((value, index) => [headers[index], value])
  ));
}

function splitCsvLine(line) {
  const values = [];
  let value = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === '"' && quoted && next === '"') {
      value += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === ',' && !quoted) {
      values.push(value);
      value = '';
    } else {
      value += char;
    }
  }
  values.push(value);
  return values;
}

async function deployedStatus(apiUrl, webUrl) {
  const checks = await Promise.allSettled([fetchUrl(deployedApiHealthUrl(apiUrl)), fetchUrl(webUrl)]);
  return checks.every((check) => check.status === 'fulfilled') ? 'configured' : 'blocked';
}

function deployedApiHealthUrl(apiUrl) {
  return new URL('/health', apiUrl).toString();
}

async function fetchUrl(url) {
  const response = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
}

export function artifactPlan(runId, mode) {
  const artifacts = [
    { label: 'Static dashboard', path: 'my-docs/evidence/fleetgraph-proof/latest.html', kind: 'html' },
    { label: 'Proof JSON', path: 'my-docs/evidence/fleetgraph-proof/latest.json', kind: 'json' },
    { label: 'Proof Markdown', path: 'my-docs/evidence/fleetgraph-proof/latest.md', kind: 'markdown' },
    { label: 'Timestamped run', path: `my-docs/evidence/fleetgraph-proof/runs/${runId}/proof.html`, kind: 'html' },
    { label: 'Golden cases', path: 'api/src/fleetgraph/eval/golden-cases.ts', kind: 'source' },
    { label: 'Executable golden-case tests', path: 'api/src/fleetgraph/eval/executable-golden-cases.test.ts', kind: 'test' },
    { label: 'Product-surface eval', path: 'my-docs/evals/fleetgraph-product-surface/latest.html', kind: 'html' },
    { label: 'Focused E2E spec', path: 'e2e/fleetgraph-attention-loop.spec.ts', kind: 'test' },
  ];
  if (mode !== 'local') {
    artifacts.splice(3, 0,
      { label: 'Public proof dashboard', path: 'web/public/fleetgraph-observability/proof/latest.html', kind: 'html' },
      { label: 'Public proof JSON', path: 'web/public/fleetgraph-observability/proof/latest.json', kind: 'json' },
      { label: 'Public proof Markdown', path: 'web/public/fleetgraph-observability/proof/latest.md', kind: 'markdown' }
    );
  }
  return artifacts;
}

export function shouldPublishPublicProof(packet) {
  return packet.target !== 'local';
}

function gitInfo() {
  return {
    branch: gitValue(['branch', '--show-current']),
    sha: gitValue(['rev-parse', 'HEAD']),
    dirty: gitValue(['status', '--short', '--untracked-files=all']).length > 0,
  };
}

function gitValue(args) {
  try {
    return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

function timestampForPath(date) {
  return date.toISOString().replace(/[:.]/g, '-');
}

function match(text, pattern) {
  return pattern.exec(text)?.[1] ?? null;
}
