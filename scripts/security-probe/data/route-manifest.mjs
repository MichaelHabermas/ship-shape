/**
 * Sensitive routes for coverage-gap reporting (attack surface census).
 * Each entry should eventually have at least one probe or an explicit owner (e2e/unit).
 */
export const ROUTE_MANIFEST = [
  { method: 'PATCH', path: '/api/documents/:id', owasp: 'A01', probeIds: ['authorization-governance-properties-injection', 'authorization-weekly-plan-idor-documents', 'input-governance-mass-assignment'] },
  { method: 'PATCH', path: '/api/programs/:id', owasp: 'A01', probeIds: ['authorization-governance-accountable-self-assign'] },
  { method: 'PATCH', path: '/api/weeks/:id', owasp: 'A01', probeIds: ['authorization-governance-week-status-bypass'] },
  { method: 'GET', path: '/api/weekly-plans/:id', owasp: 'A01', probeIds: ['authorization-weekly-plan-idor-documents'] },
  { method: 'WS', path: '/collaboration/:room', owasp: 'A01', probeIds: ['authorization-weekly-plan-idor-websocket', 'authorization-websocket-origin-reject'] },
  { method: 'POST', path: '/api/files/:id/local-upload', owasp: 'A01', probeIds: ['authorization-file-upload-hijack-denied'] },
  { method: 'POST', path: '/api/feedback/public', owasp: 'A04', probeIds: ['abuse-public-feedback-rate-limit'] },
  { method: 'POST', path: '/api/auth/login', owasp: 'A07', probeIds: ['abuse-login-rate-limit'] },
  { method: 'GET', path: '/api/admin/audit-logs', owasp: 'A01', probeIds: ['auth-session-member-audit-logs-denied'] },
  { method: 'POST', path: '/api/issues/bulk', owasp: 'A01', probeIds: ['authorization-bulk-issue-foreign-target'] },
  { method: 'GET', path: '/api/dashboard/my-focus', owasp: 'A01', probeIds: ['authorization-dashboard-private-metadata'] },
  { method: 'GET', path: '/api/setup/status', owasp: 'A05', probeIds: [] },
  { method: 'GET', path: '/api/openapi.json', owasp: 'A05', probeIds: [] },
];

export function coverageGaps(probeIdsRun) {
  const runSet = new Set(probeIdsRun);
  return ROUTE_MANIFEST.filter((route) => route.probeIds.length > 0 && !route.probeIds.some((id) => runSet.has(id)));
}
