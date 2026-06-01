import { WebSocketServer, WebSocket } from 'ws';
import { Server, IncomingMessage } from 'http';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as syncProtocol from 'y-protocols/sync';
import * as encoding from 'lib0/encoding';
import {
  COLLAB_MESSAGE_SYNC as messageSync,
  COLLAB_MESSAGE_AWARENESS as messageAwareness,
  COLLAB_MESSAGE_CLEAR_CACHE as messageClearCache,
  COLLAB_CLOSE_CODE_ACCESS_REVOKED,
  buildCollaborationRoomName,
  parseDocumentIdFromRoomName,
  parseCollaborationRoomName,
  roomPrefixMatchesDocumentType,
} from '@ship/shared';
import { pool } from '../db/client.js';
import { getDocumentTypeById } from '../db/documents-repository.js';
import { validateAuthenticatedSession } from '../services/session-auth.js';
import { isProduction } from '../config/runtime.js';
import { authorize } from '../security/capabilities.js';
import type { Principal } from '../security/principal.js';
import cookie from 'cookie';
import {
  RATE_LIMIT,
  RATE_LIMIT_VIOLATION_THRESHOLD,
  rateLimitViolations,
  docs,
  awareness,
  conns,
  eventConns,
  pendingSaves,
  docLastEditorPrincipal,
  docEvictionTimers,
  finalPersistSaves,
  freshFromJsonDocs,
  contentHistoryLastLogged,
  parseDocId,
  cleanupOldConnectionAttempts,
  isConnectionRateLimited,
  recordConnectionAttempt,
  isMessageRateLimited,
  recordMessage,
  clearRateLimitMaps,
  clearConnectionRateLimitState,
  evictCachedDocsIfNeeded,
  canAcceptCachedDoc,
  removeCachedDocState,
  getCollaborationShuttingDown,
  setCollaborationShuttingDown,
} from './runtime-state.js';
import {
  getOrCreateDoc,
  getAwareness,
  handleMessage,
  persistDocumentStrict,
  flushPendingSaves,
  trackFinalPersist,
} from './persistence.js';

const MAX_WS_MESSAGE_SIZE = 10 * 1024 * 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function validateWebSocketSession(request: IncomingMessage): Promise<Extract<Principal, { kind: 'session' }> | null> {
  const cookieHeader = request.headers.cookie;
  if (!cookieHeader) return null;

  const cookies = cookie.parse(cookieHeader);
  const sessionId = cookies.session_id;
  if (!sessionId) return null;

  try {
    const rawUserAgent: unknown = request.headers['user-agent'];
    const userAgent = Array.isArray(rawUserAgent) ? (rawUserAgent as readonly unknown[])[0] : rawUserAgent;
    const validation = await validateAuthenticatedSession(sessionId, {
      updateActivity: true,
      userAgent: typeof userAgent === 'string' ? userAgent : null,
      ipAddress: request.socket.remoteAddress || null,
    });
    if (!validation.ok || !validation.session.workspaceId) {
      return null;
    }

    return {
      kind: 'session',
      sessionId,
      userId: validation.session.userId,
      workspaceId: validation.session.workspaceId,
      isSuperAdmin: validation.session.isSuperAdmin,
    };
  } catch {
    return null;
  }
}

export async function canAccessDocumentForCollab(docId: string, principal: Principal): Promise<boolean> {
  try {
    return (await authorize(pool, principal, {
      resource: 'collaboration',
      action: 'join',
      documentId: docId,
    })).allowed;
  } catch {
    return false;
  }
}

function countConnectionsForUser(userId: string): number {
  let count = 0;
  conns.forEach((conn) => {
    if (conn.userId === userId) count += 1;
  });
  eventConns.forEach((conn) => {
    if (conn.userId === userId) count += 1;
  });
  return count;
}

function countConnectionsForWorkspace(workspaceId: string): number {
  let count = 0;
  conns.forEach((conn) => {
    if (conn.workspaceId === workspaceId) count += 1;
  });
  eventConns.forEach((conn) => {
    if (conn.workspaceId === workspaceId) count += 1;
  });
  return count;
}

function isConnectionBudgetExceeded(principal: Extract<Principal, { kind: 'session' }>): boolean {
  return countConnectionsForUser(principal.userId) >= RATE_LIMIT.MAX_CONNECTIONS_PER_USER
    || countConnectionsForWorkspace(principal.workspaceId) >= RATE_LIMIT.MAX_CONNECTIONS_PER_WORKSPACE;
}

async function revalidateConnection(
  ws: WebSocket,
  principal: Extract<Principal, { kind: 'session' }>,
  documentId?: string
): Promise<void> {
  const validation = await validateAuthenticatedSession(principal.sessionId, { updateActivity: false });
  if (!validation.ok || validation.session.workspaceId !== principal.workspaceId) {
    ws.close(4401, 'Session expired');
    return;
  }
  if (documentId && !(await canAccessDocumentForCollab(documentId, principal))) {
    ws.close(COLLAB_CLOSE_CODE_ACCESS_REVOKED, 'Access revoked');
  }
}

export const __collaborationSecurityTestHooks = {
  rateLimit: RATE_LIMIT,
  docs,
  awareness,
  conns,
  eventConns,
  canAcceptCachedDoc,
  evictCachedDocsIfNeeded,
  persistDocumentStrict,
  revalidateConnection,
  docLastEditorPrincipal,
};

export function isAllowedWebSocketOrigin(
  originHeader: string | string[] | undefined,
  allowedOrigin: string
): boolean {
  if (allowedOrigin === '*') {
    return !isProduction();
  }
  if (!originHeader) {
    return true;
  }
  const origin = Array.isArray(originHeader) ? originHeader[0] : originHeader;
  if (!origin) {
    return true;
  }
  try {
    return new URL(origin).origin === new URL(allowedOrigin).origin;
  } catch {
    return false;
  }
}

function closeOversizedOrErroredSocket(ws: WebSocket, scope: string): void {
  ws.on('error', (error: Error & { code?: string }) => {
    if (error.code !== 'WS_ERR_UNSUPPORTED_MESSAGE_LENGTH') {
      console.warn(`[${scope}] WebSocket error:`, error.message);
    }
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CLOSING) {
      ws.close(1009, 'Message too large');
    }
  });
}

function closeWebSocketServer(wss: WebSocketServer, forceAfterMs = 1000): Promise<void> {
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN || client.readyState === WebSocket.CLOSING) {
      client.close(1001, 'Server shutting down');
    }
  }

  return new Promise((resolve, reject) => {
    const forceClose = setTimeout(() => {
      for (const client of wss.clients) {
        if (client.readyState !== WebSocket.CLOSED) {
          client.terminate();
        }
      }
    }, forceAfterMs);

    wss.close((err?: Error) => {
      clearTimeout(forceClose);
      if (err) {
        reject(err);
        return;
      }
      resolve();
    });
  });
}

export function setupCollaboration(
  server: Server,
  options: { allowedOrigin?: string } = {}
): () => Promise<void> {
  const allowedOrigin = options.allowedOrigin || process.env.CORS_ORIGIN || 'http://localhost:5173';
  setCollaborationShuttingDown(false);
  const connectionAttemptCleanupInterval = setInterval(cleanupOldConnectionAttempts, 30_000);
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_WS_MESSAGE_SIZE });
  const eventsWss = new WebSocketServer({ noServer: true, maxPayload: MAX_WS_MESSAGE_SIZE });

  const handleUpgrade = async (request: IncomingMessage, socket: import('net').Socket, head: Buffer) => {
    if (getCollaborationShuttingDown()) {
      socket.destroy();
      return;
    }

    const url = new URL(request.url || '', `http://${request.headers.host}`);

    if (url.pathname === '/events') {
      const clientIp = (request.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
                       request.socket.remoteAddress ||
                       'unknown';

      if (isConnectionRateLimited(clientIp)) {
        socket.write('HTTP/1.1 429 Too Many Requests\r\n\r\n');
        socket.destroy();
        return;
      }
      recordConnectionAttempt(clientIp);

      if (!isAllowedWebSocketOrigin(request.headers.origin, allowedOrigin)) {
        socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
        socket.destroy();
        return;
      }

      const sessionData = await validateWebSocketSession(request);
      if (!sessionData) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }

      if (isConnectionBudgetExceeded(sessionData)) {
        socket.write('HTTP/1.1 429 Too Many Requests\r\n\r\n');
        socket.destroy();
        return;
      }

      eventsWss.handleUpgrade(request, socket, head, (ws) => {
        eventsWss.emit('connection', ws, sessionData);
      });
      return;
    }

    if (!url.pathname.startsWith('/collaboration/')) {
      socket.destroy();
      return;
    }

    const clientIp = (request.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
                     request.socket.remoteAddress ||
                     'unknown';

    if (isConnectionRateLimited(clientIp)) {
      socket.write('HTTP/1.1 429 Too Many Requests\r\n\r\n');
      socket.destroy();
      return;
    }
    recordConnectionAttempt(clientIp);

    if (!isAllowedWebSocketOrigin(request.headers.origin, allowedOrigin)) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }

    const sessionData = await validateWebSocketSession(request);
    if (!sessionData) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    const requestedRoom = url.pathname.replace('/collaboration/', '');
    const docId = parseDocumentIdFromRoomName(requestedRoom);

    if (isConnectionBudgetExceeded(sessionData)) {
      socket.write('HTTP/1.1 429 Too Many Requests\r\n\r\n');
      socket.destroy();
      return;
    }

    const canAccess = await canAccessDocumentForCollab(docId, sessionData);
    if (!canAccess) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }

    const documentType = await getDocumentTypeById(docId, sessionData.workspaceId);
    if (!documentType) {
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
      socket.destroy();
      return;
    }

    const parsedRoom = parseCollaborationRoomName(requestedRoom);
    if (parsedRoom && !roomPrefixMatchesDocumentType(parsedRoom.prefix, documentType)) {
      console.warn(
        `[Collaboration] Room prefix "${parsedRoom.prefix}" does not match document_type "${documentType}"; using canonical room`
      );
    }

    const docName = buildCollaborationRoomName(documentType, docId);
    if (!canAcceptCachedDoc(docName)) {
      socket.write('HTTP/1.1 429 Too Many Requests\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request, docName, sessionData);
    });
  };

  server.on('upgrade', handleUpgrade);

  wss.on('connection', async (ws: WebSocket, _request: IncomingMessage, docName: string, sessionData: Extract<Principal, { kind: 'session' }>) => {
    closeOversizedOrErroredSocket(ws, 'Collaboration');

    const doc = await getOrCreateDoc(docName, sessionData);
    const aw = getAwareness(docName, doc);

    const clientId = doc.clientID;
    const revalidateTimer = setInterval(() => {
      void revalidateConnection(ws, sessionData, parseDocId(docName));
    }, RATE_LIMIT.SESSION_REVALIDATION_MS);
    conns.set(ws, {
      docName,
      awarenessClientId: clientId,
      userId: sessionData.userId,
      workspaceId: sessionData.workspaceId,
      principal: sessionData,
      revalidateTimer,
    });
    evictCachedDocsIfNeeded();

    if (freshFromJsonDocs.has(docName)) {
      console.log(`[Collaboration] Sending cache clear signal for ${docName} (loaded fresh from JSON)`);
      const clearCacheEncoder = encoding.createEncoder();
      encoding.writeVarUint(clearCacheEncoder, messageClearCache);
      ws.send(encoding.toUint8Array(clearCacheEncoder));
      freshFromJsonDocs.delete(docName);
    }

    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, messageSync);
    syncProtocol.writeSyncStep1(encoder, doc);
    ws.send(encoding.toUint8Array(encoder));

    const awarenessStates = aw.getStates();
    if (awarenessStates.size > 0) {
      const awarenessEncoder = encoding.createEncoder();
      encoding.writeVarUint(awarenessEncoder, messageAwareness);
      encoding.writeVarUint8Array(awarenessEncoder, awarenessProtocol.encodeAwarenessUpdate(aw, Array.from(awarenessStates.keys())));
      ws.send(encoding.toUint8Array(awarenessEncoder));
    }

    ws.on('message', (data: Buffer) => {
      if (data.length > MAX_WS_MESSAGE_SIZE) {
        ws.close(1009, 'Message too large');
        return;
      }

      if (isMessageRateLimited(ws)) {
        const violations = (rateLimitViolations.get(ws) || 0) + 1;
        rateLimitViolations.set(ws, violations);

        if (violations >= RATE_LIMIT_VIOLATION_THRESHOLD) {
          ws.close(1008, 'Rate limit exceeded');
          return;
        }

        return;
      }

      rateLimitViolations.delete(ws);
      recordMessage(ws);
      docLastEditorPrincipal.set(docName, sessionData);

      handleMessage(ws, new Uint8Array(data), docName, doc, aw);
    });

    ws.on('close', () => {
      const conn = conns.get(ws);
      if (conn) {
        awarenessProtocol.removeAwarenessStates(aw, [conn.awarenessClientId], null);
        if (conn.revalidateTimer) clearInterval(conn.revalidateTimer);
        conns.delete(ws);
      }
      clearConnectionRateLimitState(ws);

      let hasConnections = false;
      conns.forEach((c) => {
        if (c.docName === docName) hasConnections = true;
      });

      if (!hasConnections) {
        const pending = pendingSaves.get(docName);
        if (pending) {
          clearTimeout(pending);
          pendingSaves.delete(docName);
          const save = persistDocumentStrict(docName, doc, docLastEditorPrincipal.get(docName) ?? sessionData);
          trackFinalPersist(save);
          void save.catch((err) => {
            console.error('Failed to persist document during connection close:', err);
          });
        }

        if (getCollaborationShuttingDown()) return;
        const evictionTimer = setTimeout(() => {
          let stillNoConnections = true;
          conns.forEach((c) => {
            if (c.docName === docName) stillNoConnections = false;
          });
          if (stillNoConnections) {
            removeCachedDocState(docName);
          }
          docEvictionTimers.delete(docName);
        }, 30000);
        docEvictionTimers.set(docName, evictionTimer);
      }
    });
  });

  eventsWss.on('connection', (ws: WebSocket, sessionData: Extract<Principal, { kind: 'session' }>) => {
    closeOversizedOrErroredSocket(ws, 'Events');

    const revalidateTimer = setInterval(() => {
      void revalidateConnection(ws, sessionData);
    }, RATE_LIMIT.SESSION_REVALIDATION_MS);
    eventConns.set(ws, {
      userId: sessionData.userId,
      workspaceId: sessionData.workspaceId,
      principal: sessionData,
      revalidateTimer,
    });
    console.log(`[Events] User ${sessionData.userId} connected (${eventConns.size} total connections)`);

    ws.send(JSON.stringify({ type: 'connected', data: {} }));

    ws.on('message', (data: Buffer) => {
      if (isMessageRateLimited(ws)) {
        const violations = (rateLimitViolations.get(ws) || 0) + 1;
        rateLimitViolations.set(ws, violations);

        if (violations >= RATE_LIMIT_VIOLATION_THRESHOLD) {
          console.log(`[Events] Rate limit violations exceeded for user ${sessionData.userId}, closing connection`);
          ws.close(1008, 'Rate limit exceeded');
        }
        return;
      }

      rateLimitViolations.delete(ws);
      recordMessage(ws);

      try {
        const message: unknown = JSON.parse(data.toString());
        if (isRecord(message) && message.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong' }));
          return;
        }
        ws.close(1003, 'Unsupported event message');
      } catch {
        ws.close(1003, 'Invalid event message');
      }
    });

    ws.on('close', () => {
      const conn = eventConns.get(ws);
      if (conn?.revalidateTimer) clearInterval(conn.revalidateTimer);
      eventConns.delete(ws);
      clearConnectionRateLimitState(ws);
      console.log(`[Events] User ${sessionData.userId} disconnected (${eventConns.size} total connections)`);
    });
  });

  console.log('Yjs collaboration server attached');
  console.log('Events WebSocket server attached');

  return async () => {
    setCollaborationShuttingDown(true);
    server.off('upgrade', handleUpgrade);
    clearInterval(connectionAttemptCleanupInterval);
    await Promise.allSettled([
      closeWebSocketServer(wss),
      closeWebSocketServer(eventsWss),
    ]);
    const finalResults = await Promise.allSettled(finalPersistSaves);
    let flushError: unknown;
    try {
      await flushPendingSaves();
    } catch (err) {
      flushError = err;
    }

    docEvictionTimers.forEach((timer) => clearTimeout(timer));
    docEvictionTimers.clear();

    clearRateLimitMaps();
    conns.clear();
    eventConns.clear();
    docs.clear();
    awareness.clear();
    docLastEditorPrincipal.clear();
    freshFromJsonDocs.clear();
    contentHistoryLastLogged.clear();

    const finalFailure = finalResults.find((result) => result.status === 'rejected');
    if (finalFailure?.status === 'rejected') throw finalFailure.reason;
    if (flushError) throw flushError;
  };
}
