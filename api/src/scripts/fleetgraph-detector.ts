// CLI entrypoint for read-only FleetGraph detector validation without enabling the worker.
import { pathToFileURL } from 'url';
import { pool } from '../db/client.js';
import { runManualFleetGraphDetector } from '../fleetgraph/manual-detector.js';

type FleetGraphDetectorCliOptions =
  | { ok: true; workspaceId: string; today?: Date; limit?: number }
  | { ok: false; error: string };

const knownFlags = new Set(['--workspace-id', '--today', '--limit']);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function usage(): string {
  return [
    'Usage: pnpm fleetgraph:detector -- --workspace-id <uuid> [--today YYYY-MM-DD] [--limit N]',
    '',
    'Runs deterministic FleetGraph detection without enabling the worker, calling a model,',
    'creating findings, or mutating Ship source records.',
  ].join('\n');
}

function parseUtcCalendarDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.toISOString().slice(0, 10) === value ? date : null;
}

export function parseFleetGraphDetectorCliArgs(args: string[]): FleetGraphDetectorCliOptions {
  const normalizedArgs = args[0] === '--' ? args.slice(1) : args;
  const values = new Map<string, string>();

  for (let index = 0; index < normalizedArgs.length; index += 1) {
    const flag = normalizedArgs[index];
    if (!flag?.startsWith('--')) {
      return { ok: false, error: `Unexpected argument: ${flag}` };
    }
    if (!knownFlags.has(flag)) {
      return { ok: false, error: `Unknown option: ${flag}` };
    }
    if (values.has(flag)) {
      return { ok: false, error: `Duplicate option: ${flag}` };
    }

    const value = normalizedArgs[index + 1];
    if (value === undefined || value.startsWith('--')) {
      return { ok: false, error: flag === '--workspace-id' ? usage() : `Missing ${flag} value` };
    }

    values.set(flag, value);
    index += 1;
  }

  const workspaceId = values.get('--workspace-id');
  if (!workspaceId) {
    return { ok: false, error: usage() };
  }
  if (!uuidPattern.test(workspaceId)) {
    return { ok: false, error: `Invalid --workspace-id value: ${workspaceId}` };
  }

  const todayArg = values.get('--today');
  const limitArg = values.get('--limit');
  const today = todayArg ? parseUtcCalendarDate(todayArg) : undefined;
  const limit = limitArg ? Number(limitArg) : undefined;

  if (todayArg && !today) {
    return { ok: false, error: `Invalid --today value: ${todayArg}` };
  }

  if (limitArg && (!Number.isInteger(limit) || Number(limit) <= 0)) {
    return { ok: false, error: `Invalid --limit value: ${limitArg}` };
  }

  return { ok: true, workspaceId, today: today ?? undefined, limit };
}

export async function main(args = process.argv.slice(2)): Promise<void> {
  const options = parseFleetGraphDetectorCliArgs(args);
  if (!options.ok) {
    console.error(options.error);
    process.exitCode = 1;
    return;
  }

  const summary = await runManualFleetGraphDetector({
    workspaceId: options.workspaceId,
    today: options.today,
    limit: options.limit,
  });

  console.log(JSON.stringify(summary, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main()
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await pool.end();
    });
}
