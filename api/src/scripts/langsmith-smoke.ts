// Creates a tiny LangSmith trace to verify local wiring.
//
// This does not call any model. It just posts a RunTree with a child "tool" span so
// you can confirm traces appear in the configured project.
import { randomUUID } from 'crypto';
import { RunTree } from 'langsmith';
import { config as loadEnv } from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load local env like the API server does.
loadEnv({ path: join(__dirname, '../../.env.local') });
loadEnv({ path: join(__dirname, '../../.env') });

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function tracingEnabled(): boolean {
  const flag = (value: string | undefined) => value === '1' || value === 'true';
  return flag(process.env.LANGSMITH_TRACING) || flag(process.env.LANGCHAIN_TRACING_V2);
}

async function main() {
  if (!tracingEnabled()) {
    throw new Error(
      'LangSmith tracing is disabled. Set LANGSMITH_TRACING=true (or LANGCHAIN_TRACING_V2=true).'
    );
  }

  // LangSmith SDK expects LANGSMITH_API_KEY; many UIs hand out LANGCHAIN_API_KEY.
  if (!process.env.LANGSMITH_API_KEY?.trim()) {
    process.env.LANGSMITH_API_KEY = requireEnv('LANGCHAIN_API_KEY');
  }

  const projectName = process.env.LANGSMITH_PROJECT?.trim() || process.env.LANGCHAIN_PROJECT?.trim() || 'default';
  const runLabel = process.env.FLEETGRAPH_TRACE_LABEL?.trim() || `fleetgraph-smoke-${randomUUID().slice(0, 8)}`;

  const parentRun = new RunTree({
    name: 'fleetgraph.trace_smoke',
    run_type: 'chain',
    project_name: projectName,
    inputs: {
      label: runLabel,
      note: 'Smoke trace to verify LangSmith wiring. No model call.',
    },
    serialized: {},
  });

  await parentRun.postRun();

  const childRun = await parentRun.createChild({
    name: 'fleetgraph.detector_dry_run',
    run_type: 'tool',
    inputs: {
      mode: 'proactive',
      modelCalls: 0,
    },
  });

  await childRun.postRun();
  await childRun.end({
    outputs: {
      ok: true,
      detail: 'No-op tool span; posted successfully.',
    },
  });
  await childRun.patchRun();

  await parentRun.end({
    outputs: {
      ok: true,
      project: projectName,
      label: runLabel,
      runId: parentRun.id,
    },
  });
  await parentRun.patchRun();

  console.log(JSON.stringify({ ok: true, project: projectName, runId: parentRun.id, label: runLabel }, null, 2));
  console.log('Open LangSmith → Tracing → project → latest run should be this id.');
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});

