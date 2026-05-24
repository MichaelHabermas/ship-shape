#!/usr/bin/env node
console.warn('Deprecated: use `pnpm exec shipshape-security findings`');
import { runCli } from '../../packages/shipshape-security/src/cli/router.mjs';

const [sub, ...rest] = process.argv.slice(2);
runCli(['findings', sub, ...rest]).catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
