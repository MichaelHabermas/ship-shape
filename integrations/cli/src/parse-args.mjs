// Shared argv parser for ship CLI commands and tests.
export function parseArgs(argv) {
  const flags = {};
  const positionals = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('-')) {
      positionals.push(arg);
      continue;
    }
    const raw = arg.replace(/^-+/, '');
    const [inlineKey, inlineValue] = raw.split('=', 2);
    if (inlineValue !== undefined) {
      flags[inlineKey] = inlineValue;
      continue;
    }
    const next = argv[index + 1];
    if (next && !next.startsWith('-')) {
      flags[inlineKey] = next;
      index += 1;
    } else {
      flags[inlineKey] = true;
    }
  }
  return { flags, positionals };
}
