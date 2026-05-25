import { websocketProbe } from '../../../packages/shipshape-security/src/core/ws-raw.mjs';
import { fail, finding, pass, skip } from '../../../packages/shipshape-security/src/core/result-model.mjs';
import { runSelectedProbes } from '../../../packages/shipshape-security/src/core/probe-selection.mjs';
import { marker } from '../fixtures/payloads.mjs';

export async function websocketValidationProbes(context) {
  return runSelectedProbes(context, [
    { id: 'websocket-no-cookie-denied', name: 'Unauthenticated collaboration upgrade rejected', run: noCookieDenied },
    { id: 'websocket-nonexistent-doc-denied', name: 'Nonexistent collaboration document rejected', run: nonexistentDocDenied },
    { id: 'websocket-malformed-frame', name: 'Malformed WebSocket message rejected deterministically', run: malformedFrame, requiresWrite: true },
    { id: 'websocket-unknown-message-type', name: 'Unknown WebSocket message type rejected deterministically', run: unknownMessageType, requiresWrite: true },
    { id: 'websocket-oversized-frame', name: 'Oversized WebSocket frame bounded by server', run: oversizedFrame, requiresWrite: true, requiresStress: true },
    { id: 'websocket-events-malformed-message', name: 'Malformed events WebSocket message rejected', run: eventsMalformedMessage },
    { id: 'websocket-events-unknown-message-type', name: 'Unknown events WebSocket message rejected', run: eventsUnknownMessageType },
  ]);
}

async function createProbeDocument({ clients, config }) {
  const result = await clients.admin.api('/api/documents', {
    method: 'POST',
    body: {
      title: `${marker(config.runId)} websocket probe`,
      document_type: 'wiki',
      visibility: 'workspace',
    },
  });
  return result.json?.id || result.json?.data?.id || result.json?.document?.id;
}

async function noCookieDenied({ config }) {
  const result = await websocketProbe({
    wsUrl: config.wsUrl,
    path: '/collaboration/wiki:00000000-0000-4000-8000-000000000001',
  });
  if (result.status === 401) return pass('websocket-no-cookie-denied', 'Unauthenticated collaboration upgrade rejected');
  return fail('websocket-no-cookie-denied', 'Unauthenticated collaboration upgrade rejected', finding({
    id: 'cat8-ws-unauthenticated-upgrade',
    probeId: 'websocket-no-cookie-denied',
    title: 'WebSocket collaboration accepted unauthenticated upgrade',
    severity: 'high',
    category: 'websocket',
    affected: { endpoint: '/collaboration/wiki:<docId>' },
    expected: 'Upgrade without session cookie returns 401.',
    observed: `Upgrade result: ${JSON.stringify(result)}`,
    evidence: { reproduction: ['Run pnpm security:probe -- --probe websocket-no-cookie-denied'] },
  }));
}

async function nonexistentDocDenied({ config, clients }) {
  const result = await websocketProbe({
    wsUrl: config.wsUrl,
    path: '/collaboration/wiki:00000000-0000-4000-8000-000000000001',
    cookieHeader: clients.admin.cookieHeader(),
  });
  if (result.status === 403 || result.status === 404) return pass('websocket-nonexistent-doc-denied', 'Nonexistent collaboration document rejected');
  return fail('websocket-nonexistent-doc-denied', 'Nonexistent collaboration document rejected', finding({
    id: 'cat8-ws-nonexistent-doc',
    probeId: 'websocket-nonexistent-doc-denied',
    title: 'WebSocket collaboration did not reject nonexistent document',
    severity: 'medium',
    category: 'websocket',
    affected: { endpoint: '/collaboration/wiki:<missingDocId>' },
    expected: 'Missing document returns 403 or 404 during upgrade.',
    observed: `Upgrade result: ${JSON.stringify(result)}`,
    evidence: { reproduction: ['Run pnpm security:probe -- --probe websocket-nonexistent-doc-denied'] },
  }));
}

async function malformedFrame(context) {
  const { config, clients } = context;
  if (!config.allowWrite) return skip('websocket-malformed-frame', 'Malformed frame handling', 'write probes disabled');
  const docId = await createProbeDocument(context);
  if (!docId) return skip('websocket-malformed-frame', 'Malformed frame handling', 'could not create probe document');
  const result = await websocketProbe({
    wsUrl: config.wsUrl,
    path: `/collaboration/wiki:${docId}`,
    cookieHeader: clients.admin.cookieHeader(),
    payload: Uint8Array.from([128]),
  });
  const health = await clients.admin.request('/health');
  if (health.status === 200 && result.closeCode === 1003) {
    return pass('websocket-malformed-frame', 'Malformed WebSocket message rejected deterministically', { closeCode: result.closeCode });
  }
  return fail('websocket-malformed-frame', 'Malformed WebSocket message rejected deterministically', finding({
    id: 'cat8-ws-malformed-frame',
    probeId: 'websocket-malformed-frame',
    title: 'Malformed WebSocket message was not handled safely',
    severity: 'high',
    category: 'websocket',
    affected: { endpoint: '/collaboration/wiki:<docId>' },
    expected: 'Malformed binary messages close with 1003 and /health remains available.',
    observed: `WebSocket result ${JSON.stringify(result)}, health HTTP ${health.status}.`,
    evidence: { reproduction: ['Run pnpm security:probe -- --probe websocket-malformed-frame'] },
    fixCandidate: 'Wrap collaboration message decoding in try/catch and close with a protocol/policy code.',
  }));
}

async function unknownMessageType(context) {
  const { config, clients } = context;
  if (!config.allowWrite) return skip('websocket-unknown-message-type', 'Unknown message type handling', 'write probes disabled');
  const docId = await createProbeDocument(context);
  if (!docId) return skip('websocket-unknown-message-type', 'Unknown message type handling', 'could not create probe document');
  const result = await websocketProbe({
    wsUrl: config.wsUrl,
    path: `/collaboration/wiki:${docId}`,
    cookieHeader: clients.admin.cookieHeader(),
    payload: Uint8Array.from([9]),
  });
  const health = await clients.admin.request('/health');
  if (health.status === 200 && result.closeCode === 1003) return pass('websocket-unknown-message-type', 'Unknown WebSocket message type rejected deterministically', { closeCode: result.closeCode });
  return fail('websocket-unknown-message-type', 'Unknown WebSocket message type rejected deterministically', finding({
    id: 'cat8-ws-unknown-message-type',
    probeId: 'websocket-unknown-message-type',
    title: 'Unknown WebSocket message type was silently ignored',
    severity: 'medium',
    category: 'websocket',
    affected: { endpoint: '/collaboration/wiki:<docId>' },
    expected: 'Unexpected message types are explicitly rejected while the server stays healthy.',
    observed: `WebSocket result ${JSON.stringify(result)}, health HTTP ${health.status}.`,
    evidence: { reproduction: ['Run pnpm security:probe -- --probe websocket-unknown-message-type'] },
    fixCandidate: 'Add a default branch in collaboration message handling that closes with an unsupported-data or policy code.',
  }));
}

async function oversizedFrame(context) {
  const { config, clients } = context;
  if (!config.allowStress) return skip('websocket-oversized-frame', 'Oversized WebSocket frame handling', 'stress probes disabled');
  const docId = await createProbeDocument(context);
  if (!docId) return skip('websocket-oversized-frame', 'Oversized WebSocket frame handling', 'could not create probe document');
  const payload = new Uint8Array(config.maxPayloadMb * 1024 * 1024);
  payload.fill(1);
  const result = await websocketProbe({
    wsUrl: config.wsUrl,
    path: `/collaboration/wiki:${docId}`,
    cookieHeader: clients.admin.cookieHeader(),
    payload,
    timeoutMs: 4000,
  });
  if (result.closeCode === 1009) return pass('websocket-oversized-frame', 'Oversized WebSocket frame bounded by server', { closeCode: result.closeCode });
  return fail('websocket-oversized-frame', 'Oversized WebSocket frame bounded by server', finding({
    id: 'cat8-ws-oversized-frame',
    probeId: 'websocket-oversized-frame',
    title: 'Oversized WebSocket payload did not close cleanly',
    severity: 'medium',
    category: 'websocket',
    expected: 'Payload above server limit closes with 1009 or a safe connection termination.',
    observed: `WebSocket result: ${JSON.stringify(result)}`,
    evidence: { reproduction: ['Run pnpm security:probe -- --probe websocket-oversized-frame'] },
  }));
}

async function eventsMalformedMessage({ config, clients }) {
  const result = await websocketProbe({
    wsUrl: config.wsUrl,
    path: '/events',
    cookieHeader: clients.admin.cookieHeader(),
    payload: Uint8Array.from([0xff, 0xfe, 0xfd]),
  });
  if (result.closeCode === 1003) return pass('websocket-events-malformed-message', 'Malformed events WebSocket message rejected', { closeCode: result.closeCode });
  return fail('websocket-events-malformed-message', 'Malformed events WebSocket message rejected', finding({
    id: 'cat8-ws-events-malformed-message',
    probeId: 'websocket-events-malformed-message',
    title: 'Events WebSocket did not reject malformed message',
    severity: 'medium',
    category: 'websocket',
    affected: { endpoint: '/events' },
    expected: 'Malformed authenticated events messages close with 1003.',
    observed: `WebSocket result ${JSON.stringify(result)}.`,
    evidence: { reproduction: ['Run pnpm security:probe -- --probe websocket-events-malformed-message'] },
  }));
}

async function eventsUnknownMessageType({ config, clients }) {
  const result = await websocketProbe({
    wsUrl: config.wsUrl,
    path: '/events',
    cookieHeader: clients.admin.cookieHeader(),
    textPayload: JSON.stringify({ type: 'unknown-cat8-probe' }),
  });
  if (result.closeCode === 1003) return pass('websocket-events-unknown-message-type', 'Unknown events WebSocket message rejected', { closeCode: result.closeCode });
  return fail('websocket-events-unknown-message-type', 'Unknown events WebSocket message rejected', finding({
    id: 'cat8-ws-events-unknown-message-type',
    probeId: 'websocket-events-unknown-message-type',
    title: 'Events WebSocket did not reject unknown message type',
    severity: 'medium',
    category: 'websocket',
    affected: { endpoint: '/events' },
    expected: 'Unknown authenticated events messages close with 1003.',
    observed: `WebSocket result ${JSON.stringify(result)}.`,
    evidence: { reproduction: ['Run pnpm security:probe -- --probe websocket-events-unknown-message-type'] },
  }));
}
