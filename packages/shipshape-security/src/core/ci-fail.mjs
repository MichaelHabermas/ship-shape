/**
 * Exit policy for security probe runs (used by run.mjs and unit tests).
 */
export function shouldFailSecurityProbeRun({ failOn, triage }) {
  if (failOn === 'none') {
    return { fail: false };
  }

  if (failOn === 'new') {
    if (triage.counts.new > 0) {
      return {
        fail: true,
        reason: `${triage.counts.new} new finding(s) not in security-findings.json`,
        exitCode: 2,
      };
    }
    if (triage.counts.regression > 0) {
      return {
        fail: true,
        reason: `${triage.counts.regression} regression(s) (registry marked fixed/control, probe failed)`,
        exitCode: 2,
      };
    }
    return { fail: false };
  }

  return { fail: false, delegated: true };
}
