// Runs the FleetGraph observability trial, provider-history sync, and dashboard generation with forwarded flags.
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);

run('pnpm', ['--filter', '@ship/api', 'fleetgraph:observe', ...args]);
run('pnpm', ['fleetgraph:observe:sync']);
run('pnpm', ['fleetgraph:observe:dashboard']);

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: '/Users/michaelhabermas/repos/GAI/ship-shape',
    stdio: 'inherit',
    shell: false,
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
