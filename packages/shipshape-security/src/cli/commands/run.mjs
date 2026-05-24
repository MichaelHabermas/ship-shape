import { runProbe } from '../../core/run-probe.mjs';

export async function runRunCommand(argv) {
  await runProbe(argv);
}
