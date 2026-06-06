// Parse Playwright shard summary.json for shell wrappers and watch-tests.
import { readFileSync } from 'node:fs';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

export function readSummary(filePath) {
  const data = JSON.parse(readFileSync(filePath, 'utf8'));
  return {
    total: Number(data.total ?? 0),
    passed: Number(data.passed ?? 0),
    failed: Number(data.failed ?? 0),
    skipped: Number(data.skipped ?? 0),
    pending: Number(data.pending ?? 0),
    ts: Number(data.ts ?? 0),
  };
}

function main() {
  const [command, filePath] = process.argv.slice(2);
  if (!command || !filePath) {
    console.error('Usage: node e2e-summary.mjs <counts|failed|status-line> <summary.json>');
    process.exit(1);
  }

  const summary = readSummary(filePath);
  if (command === 'counts') {
    process.stdout.write(`${summary.failed} ${summary.passed}`);
    return;
  }
  if (command === 'failed') {
    process.stdout.write(String(summary.failed));
    return;
  }
  if (command === 'status-line') {
    process.stdout.write([
      summary.total,
      summary.passed,
      summary.failed,
      summary.skipped,
      summary.pending,
      summary.ts,
    ].join(' '));
    return;
  }

  console.error(`Unknown command: ${command}`);
  process.exit(1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
