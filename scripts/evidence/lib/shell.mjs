// Thin wrapper: evidence collectors expect { ok, code } subprocess results.
import { runCommand as runCommandCore } from '../../lib/run-command.mjs';

export function runCommand(command, args, options = {}) {
  return runCommandCore(command, args, {
    ...options,
    throwOnFail: false,
    tailChars: null,
  }).then((result) => ({
    ok: result.ok,
    code: result.code,
    stdout: result.stdout,
    stderr: result.stderr,
  }));
}
