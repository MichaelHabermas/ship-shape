#!/usr/bin/env node
// Deprecated wrapper — canonical implementation: packages/shipshape-security (CLI + Security Console via pnpm security:console).
console.warn('Deprecated: use `pnpm exec shipshape-security run` (or pnpm security:probe)');
import { runProbe } from '../../packages/shipshape-security/src/core/run-probe.mjs';

runProbe(process.argv.slice(2)).catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
