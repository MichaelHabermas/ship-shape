import { skip, timed } from './result-model.mjs';

export function probeMatches(selectedProbe, id) {
  return !selectedProbe || id === selectedProbe || id.startsWith(selectedProbe);
}

export async function runSelectedProbes(context, definitions) {
  const results = [];
  for (const definition of definitions) {
    if (!probeMatches(context.config.probe, definition.id)) {
      results.push(skip(definition.id, definition.name, `filtered by --probe ${context.config.probe}`));
      continue;
    }
    if (definition.requiresWrite && !context.config.allowWrite) {
      results.push(skip(definition.id, definition.name, 'write probes disabled'));
      continue;
    }
    if (definition.requiresStress && !context.config.allowStress) {
      results.push(skip(definition.id, definition.name, 'stress probes disabled'));
      continue;
    }
    results.push(await timed(definition.run(context)));
  }
  return results;
}
