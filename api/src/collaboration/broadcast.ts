import { WebSocket } from 'ws';
import {
  COLLAB_CLOSE_CODE_CONVERSION,
  COLLAB_CLOSE_CODE_CONTENT_UPDATE,
  COLLAB_CLOSE_CODE_ACCESS_REVOKED,
  type ConversionDocumentType,
  type AccountabilityUpdatedPayload,
} from '@ship/shared';
import {
  docs,
  awareness,
  conns,
  eventConns,
  pendingSaves,
  parseDocId,
} from './runtime-state.js';
import { canAccessDocumentForCollab } from './server.js';

export function invalidateDocumentCache(docId: string): void {
  const docNamesToInvalidate: string[] = [];
  docs.forEach((_, docName) => {
    if (parseDocId(docName) === docId) {
      docNamesToInvalidate.push(docName);
    }
  });

  if (docNamesToInvalidate.length === 0) {
    console.log(`[Collaboration] No cached doc found for ${docId}`);
    return;
  }

  for (const docName of docNamesToInvalidate) {
    const connectionsToClose: WebSocket[] = [];
    conns.forEach((conn, ws) => {
      if (conn.docName === docName) {
        connectionsToClose.push(ws);
      }
    });

    for (const ws of connectionsToClose) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.close(COLLAB_CLOSE_CODE_CONTENT_UPDATE, 'Content updated');
      }
    }

    const pendingSave = pendingSaves.get(docName);
    if (pendingSave) {
      clearTimeout(pendingSave);
      pendingSaves.delete(docName);
    }

    docs.delete(docName);
    awareness.delete(docName);

    console.log(`[Collaboration] Invalidated cache for ${docName}`);
  }
}

export function handleDocumentConversion(
  oldDocId: string,
  newDocId: string,
  _oldDocType: ConversionDocumentType,
  newDocType: ConversionDocumentType
): void {
  const connectionsToNotify: Array<{ ws: WebSocket; conn: NonNullable<ReturnType<typeof conns.get>> }> = [];

  conns.forEach((conn, ws) => {
    const connDocId = parseDocId(conn.docName);
    if (connDocId === oldDocId) {
      connectionsToNotify.push({ ws, conn });
    }
  });

  if (connectionsToNotify.length === 0) {
    return;
  }

  console.log(`[Collaboration] Document ${oldDocId} converted to ${newDocType} (${newDocId}), notifying ${connectionsToNotify.length} collaborators`);

  const closeReason = JSON.stringify({
    newDocId,
    newDocType,
  });

  for (const { ws } of connectionsToNotify) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.close(COLLAB_CLOSE_CODE_CONVERSION, closeReason);
    }
  }
}

export async function handleVisibilityChange(
  docId: string,
  newVisibility: 'private' | 'workspace',
  creatorId: string
): Promise<void> {
  const connectionsToCheck: Array<{ ws: WebSocket; conn: NonNullable<ReturnType<typeof conns.get>> }> = [];

  conns.forEach((conn, ws) => {
    const connDocId = parseDocId(conn.docName);
    if (connDocId === docId) {
      connectionsToCheck.push({ ws, conn });
    }
  });

  if (connectionsToCheck.length === 0) {
    return;
  }

  console.log(`[Collaboration] Visibility change for doc ${docId} to '${newVisibility}', checking ${connectionsToCheck.length} connections`);

  if (newVisibility === 'workspace') {
    return;
  }

  for (const { ws, conn } of connectionsToCheck) {
    if (conn.userId === creatorId) {
      continue;
    }

    const canAccess = await canAccessDocumentForCollab(docId, conn.principal);

    if (!canAccess) {
      console.log(`[Collaboration] Disconnecting user ${conn.userId} from private doc ${docId}`);
      ws.close(COLLAB_CLOSE_CODE_ACCESS_REVOKED, 'Document access revoked');
    }
  }
}

export function broadcastToUser(
  userId: string,
  eventType: 'accountability:updated',
  data?: AccountabilityUpdatedPayload,
): void;
export function broadcastToUser(userId: string, eventType: string, data?: Record<string, unknown>): void;
export function broadcastToUser(
  userId: string,
  eventType: string,
  data?: AccountabilityUpdatedPayload | Record<string, unknown>,
): void {
  const payload = JSON.stringify({ type: eventType, data: data || {} });

  let sentCount = 0;
  eventConns.forEach((conn, ws) => {
    if (conn.userId === userId && ws.readyState === WebSocket.OPEN) {
      ws.send(payload);
      sentCount++;
    }
  });

  if (sentCount > 0) {
    console.log(`[Events] Broadcast '${eventType}' to user ${userId} (${sentCount} connections)`);
  }
}
