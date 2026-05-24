#!/usr/bin/env node
import { runCli } from '../src/cli/router.mjs';

runCli(process.argv.slice(2)).catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
