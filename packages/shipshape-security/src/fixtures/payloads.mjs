export const RUN_MARKER_PREFIX = 'security-probe';

export function marker(runId) {
  return `[${RUN_MARKER_PREFIX}:${runId}]`;
}

export const xssPayload = '<img src=x onerror=alert("cat8")><script>alert("cat8")</script>';
export const sqlPayload = "' OR '1'='1; SELECT * FROM users; --";
export const longPayload = 'A'.repeat(12000);

