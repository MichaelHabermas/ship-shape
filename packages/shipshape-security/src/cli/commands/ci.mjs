import { repoRoot } from '../../core/paths.mjs';
import { runConsoleJob } from '../../console/job-runner.mjs';

export function runCiCommand() {
  return runConsoleJob('ci', { cwd: repoRoot }, (line) => console.log(line)).then((result) => {
    if (!result.ok) throw new Error(`CI exited with ${result.exitCode}`);
  });
}
