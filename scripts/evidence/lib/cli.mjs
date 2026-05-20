export function parseArgs(argv) {
  const options = {};
  const positional = [];

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (!arg.startsWith('--')) {
      positional.push(arg);
      continue;
    }

    const [rawKey, inlineValue] = arg.slice(2).split('=', 2);
    const key = rawKey.replace(/-([a-z])/g, (_, char) => char.toUpperCase());
    const nextValue = argv[index + 1];

    if (inlineValue !== undefined) {
      options[key] = inlineValue;
    } else if (nextValue && !nextValue.startsWith('--')) {
      options[key] = nextValue;
      index++;
    } else {
      options[key] = true;
    }
  }

  return { options, positional };
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
