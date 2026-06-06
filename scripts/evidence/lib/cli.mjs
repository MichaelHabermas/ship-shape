// Evidence CLI flag parsing (kebab-case keys become camelCase options).
import { parseArgsCamel } from '../../lib/parse-args.mjs';

export function parseArgs(argv) {
  return parseArgsCamel(argv);
}

export function defaultRunId(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, '-');
}

export function validateRunId(runId) {
  if (!/^[a-zA-Z0-9._-]+$/.test(runId)) {
    throw new Error(`Invalid run id "${runId}". Use only letters, numbers, dots, underscores, and hyphens.`);
  }
  return runId;
}
