// Generic CLI flag parsing for scripts (--key=value, boolean flags, positionals).
export function parseArgsMap(argv) {
  const args = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) continue;
    const inline = arg.indexOf('=');
    if (inline !== -1) {
      args.set(arg.slice(2, inline), arg.slice(inline + 1));
      continue;
    }
    const key = arg.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith('--')) {
      args.set(key, next);
      index += 1;
    } else {
      args.set(key, 'true');
    }
  }
  return args;
}

export function parseArgsObject(argv) {
  const options = {};
  const positional = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) {
      positional.push(arg);
      continue;
    }

    const inline = arg.indexOf('=');
    if (inline !== -1) {
      options[arg.slice(2, inline)] = arg.slice(inline + 1);
      continue;
    }

    const key = arg.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith('--')) {
      options[key] = next;
      index += 1;
    } else {
      options[key] = true;
    }
  }

  return { options, positional };
}

export function parseArgsFlat(argv) {
  const args = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith('--')) {
      args._.push(value);
      continue;
    }
    const key = value.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
      continue;
    }
    args[key] = next;
    index += 1;
  }
  return args;
}

export function parseArgsCamel(argv) {
  const { options, positional } = parseArgsObject(argv);
  const camelOptions = {};
  for (const [key, value] of Object.entries(options)) {
    const camelKey = key.replace(/-([a-z])/g, (_, char) => char.toUpperCase());
    camelOptions[camelKey] = value;
  }
  return { options: camelOptions, positional };
}
