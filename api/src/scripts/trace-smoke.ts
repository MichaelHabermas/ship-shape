// Creates tiny external traces to verify FleetGraph reviewer trace wiring.
import { randomUUID } from 'crypto';
import { config as loadEnv } from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { shutdownFleetGraphTracing, withFleetGraphTrace } from '../fleetgraph/observability-trace.js';
import type { FleetGraphResult } from '../fleetgraph/types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

loadEnv({ path: join(__dirname, '../../.env.local') });
loadEnv({ path: join(__dirname, '../../.env') });

async function main() {
  const runLabel = process.env.FLEETGRAPH_TRACE_LABEL?.trim() || `fleetgraph-smoke-${randomUUID().slice(0, 8)}`;
  const capture = await withSmokeTimeout(withFleetGraphTrace({
    name: 'fleetgraph.trace_smoke',
    inputs: {
      label: runLabel,
      note: 'Smoke trace to verify FleetGraph external tracing. No model call.',
    },
  }, async (trace) => smokeResult(trace.traceId, trace.traceUrl)));
  await shutdownFleetGraphTracing();

  console.log(JSON.stringify({
    ok: true,
    traceId: capture.traceId,
    traceUrl: capture.traceUrl,
    sharedTraceUrl: capture.sharedTraceUrl,
    providers: capture.providers,
    label: runLabel,
  }, null, 2));
}

async function withSmokeTimeout<T>(promise: Promise<T>): Promise<T> {
  const timeoutMs = Number(process.env.FLEETGRAPH_TRACE_SMOKE_TIMEOUT_MS ?? 30000);
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error(`FleetGraph trace smoke timed out after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function smokeResult(traceId: string | undefined, traceUrl: string | undefined): FleetGraphResult {
  const traceMetadata = {
    traceId,
    traceUrl,
    mode: 'proactive' as const,
    decision: 'quiet_exit' as const,
    nodePath: ['normalizeTrigger', 'detector_dry_run', 'persistFleetGraphState'],
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
      trigger_reason: 'trace_smoke',
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
      triggerReason: 'trace_smoke',
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
      title: 'FleetGraph trace smoke',
      summary: 'No-op trace smoke completed.',
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
  });
