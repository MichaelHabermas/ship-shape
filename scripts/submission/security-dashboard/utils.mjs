export function securitySeverityRank(severity) {
  return { critical: 4, high: 3, medium: 2, low: 1 }[String(severity || '').toLowerCase()] || 0;
}

export function securityStatusClass(status) {
  const normalized = String(status || '').toLowerCase();
  if (normalized === 'fixed' || normalized === 'control') return 'pass';
  if (normalized === 'open') return 'warn';
  return '';
}

export function securitySurfaceLabel(id) {
  if (id?.startsWith('auth-session')) return 'Auth/session';
  if (id?.startsWith('authorization')) return 'Authorization';
  if (id?.startsWith('websocket')) return 'WebSocket';
  if (id?.startsWith('input')) return 'Input';
  if (id?.startsWith('dependency')) return 'Dependencies';
  if (id?.startsWith('manual')) return 'Manual review';
  if (id?.startsWith('abuse')) return 'Abuse controls';
  return 'Other';
}

export { markdownToHtml } from '../../../packages/shipshape-security/src/core/markdown-lite.mjs';
