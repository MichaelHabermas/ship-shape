import { WebSocketServer, WebSocket } from 'ws';
import { Server, IncomingMessage } from 'http';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import { pool } from '../db/client.js';
import { extractHypothesisFromContent, extractSuccessCriteriaFromContent, extractVisionFromContent, extractGoalsFromContent } from '../utils/extractHypothesis.js';
import { yjsToJson, jsonToYjs } from '../utils/yjsConverter.js';
import { resolveInitialContent } from '../db/document-content-codec.js';
import { upsertDocumentSearchIndex } from '../utils/tiptap-search.js';
import {
  COLLAB_MESSAGE_SYNC as messageSync,
  COLLAB_MESSAGE_AWARENESS as messageAwareness,
  COLLAB_MESSAGE_CLEAR_CACHE as messageClearCache,
  COLLAB_CLOSE_CODE_CONVERSION,
  COLLAB_CLOSE_CODE_CONTENT_UPDATE,
  COLLAB_CLOSE_CODE_ACCESS_REVOKED,
  buildCollaborationRoomName,
  parseDocumentIdFromRoomName,
  parseCollaborationRoomName,
  roomPrefixMatchesDocumentType,
  type ConversionDocumentType,
} from '@ship/shared';
import { getDocumentTypeById } from '../db/documents-repository.js';
import { validateAuthenticatedSession } from '../services/session-auth.js';
import { isProduction } from '../config/runtime.js';
import { authorize } from '../security/capabilities.js';
import type { Principal } from '../security/principal.js';
import cookie from 'cookie';

// Rate limiting configuration
function readPositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const RATE_LIMIT = {
  // Connection rate limiting: max connections per IP in time window
  CONNECTION_WINDOW_MS: 60_000,  // 1 minute window
  MAX_CONNECTIONS_PER_IP: readPositiveIntEnv('COLLAB_MAX_CONNECTIONS_PER_IP', 30),
  MAX_CONNECTIONS_PER_USER: readPositiveIntEnv('COLLAB_MAX_CONNECTIONS_PER_USER', 20),
  MAX_CONNECTIONS_PER_WORKSPACE: readPositiveIntEnv('COLLAB_MAX_CONNECTIONS_PER_WORKSPACE', 200),
  MAX_CACHED_DOCS: readPositiveIntEnv('COLLAB_MAX_CACHED_DOCS', 200),
  SESSION_REVALIDATION_MS: readPositiveIntEnv('COLLAB_SESSION_REVALIDATION_MS', 60_000),
  // Message rate limiting: max messages per connection in time window
  MESSAGE_WINDOW_MS: 1_000,      // 1 second window
  MAX_MESSAGES_PER_SECOND: 50,   // 50 messages per second per connection
};

// Track connection attempts per IP (sliding window)
const connectionAttempts = new Map<string, number[]>();

// Track message timestamps per WebSocket connection
const messageTimestamps = new Map<WebSocket, number[]>();

// DDoS protection: Track rate limit violations per connection for progressive penalties
const rateLimitViolations = new Map<WebSocket, number>();
const RATE_LIMIT_VIOLATION_THRESHOLD = 50; // Close connection after 50 violations

function cleanupOldConnectionAttempts(): void {
  const now = Date.now();
  connectionAttempts.forEach((timestamps, ip) => {
    const valid = timestamps.filter(t => now - t < RATE_LIMIT.CONNECTION_WINDOW_MS);
    if (valid.length === 0) {
      connectionAttempts.delete(ip);
    } else {
      connectionAttempts.set(ip, valid);
    }
  });
}

// Check if IP is rate limited for new connections
function isConnectionRateLimited(ip: string): boolean {
  const now = Date.now();
  const attempts = connectionAttempts.get(ip) || [];
  const recentAttempts = attempts.filter(t => now - t < RATE_LIMIT.CONNECTION_WINDOW_MS);
  return recentAttempts.length >= RATE_LIMIT.MAX_CONNECTIONS_PER_IP;
}

// Record a connection attempt from an IP
function recordConnectionAttempt(ip: string): void {
  const now = Date.now();
  const attempts = connectionAttempts.get(ip) || [];
  attempts.push(now);
  // Keep only recent attempts to limit memory usage
  const recentAttempts = attempts.filter(t => now - t < RATE_LIMIT.CONNECTION_WINDOW_MS);
  connectionAttempts.set(ip, recentAttempts);
}

// Check if a WebSocket connection is rate limited for messages
function isMessageRateLimited(ws: WebSocket): boolean {
  const now = Date.now();
  const timestamps = messageTimestamps.get(ws) || [];
  const recentMessages = timestamps.filter(t => now - t < RATE_LIMIT.MESSAGE_WINDOW_MS);
  return recentMessages.length >= RATE_LIMIT.MAX_MESSAGES_PER_SECOND;
}

// Record a message from a WebSocket connection
function recordMessage(ws: WebSocket): void {
  const now = Date.now();
  const timestamps = messageTimestamps.get(ws) || [];
  timestamps.push(now);
  // Keep only recent timestamps to limit memory usage
  const recentTimestamps = timestamps.filter(t => now - t < RATE_LIMIT.MESSAGE_WINDOW_MS);
  messageTimestamps.set(ws, recentTimestamps);
}

// Store documents and awareness by room name
const docs = new Map<string, Y.Doc>();
const awareness = new Map<string, awarenessProtocol.Awareness>();
const conns = new Map<WebSocket, { docName: string; awarenessClientId: number; userId: string; workspaceId: string; principal: Principal; revalidateTimer?: NodeJS.Timeout }>();

// Global events connections (separate from document collaboration)
// These persist across navigation and are used for real-time notifications
const eventConns = new Map<WebSocket, { userId: string; workspaceId: string; principal: Principal; revalidateTimer?: NodeJS.Timeout }>();

// Debounce persistence (save every 2 seconds after changes)
const pendingSaves = new Map<string, NodeJS.Timeout>();
const docLastEditorPrincipal = new Map<string, Principal>();

function parseDocId(docName: string): string {
  return parseDocumentIdFromRoomName(docName);
}

// Track last content history log time per document to avoid excessive logging
const contentHistoryLastLogged = new Map<string, number>();
const CONTENT_HISTORY_MIN_INTERVAL_MS = 60_000; // Log at most once per minute per document
const docEvictionTimers = new Map<string, NodeJS.Timeout>();
const finalPersistSaves = new Set<Promise<void>>();
let collaborationShuttingDown = false;

async function persistDocumentStrict(docName: string, doc: Y.Doc, principal?: Principal) {
  const state = Y.encodeStateAsUpdate(doc);
  const docId = parseDocId(docName);
  const editorPrincipal = principal ?? docLastEditorPrincipal.get(docName);

  if (!editorPrincipal) {
    console.warn(`[Collaboration] Skipping persist for ${docName}: no editor principal available`);
    return;
  }

  const persistDecision = await authorize(pool, editorPrincipal, {
    resource: 'collaboration',
    action: 'persist',
    documentId: docId,
  });
  if (!persistDecision.allowed) {
    console.warn(`[Collaboration] Skipping persist for ${docName}: ${persistDecision.reason}`);
    return;
  }

  // Convert Yjs to TipTap JSON to extract hypothesis/criteria and keep content in sync
  const fragment = doc.getXmlFragment('default');
  const content = yjsToJson(fragment);

  // Extract hypothesis, success criteria, vision, and goals from content
  const hypothesis = extractHypothesisFromContent(content);
  const successCriteria = extractSuccessCriteriaFromContent(content);
  const vision = extractVisionFromContent(content);
  const goals = extractGoalsFromContent(content);

  // Get existing properties, document_type, and content to check for changes
  const existingResult = await pool.query(
    'SELECT properties, document_type, content, created_by FROM documents WHERE id = $1',
    [docId]
  );
  const existingProps = existingResult.rows[0]?.properties || {};
  const documentType = existingResult.rows[0]?.document_type;
  const existingContent = existingResult.rows[0]?.content;
  const createdBy = existingResult.rows[0]?.created_by;

  // For weekly_plan and weekly_retro documents, log content history when content changes
  // This provides full version history for accountability audit trails
  if ((documentType === 'weekly_plan' || documentType === 'weekly_retro') && createdBy) {
    const newContentStr = JSON.stringify(content);
    const oldContentStr = existingContent ? JSON.stringify(existingContent) : null;

    // Only log if content actually changed and enough time has passed since last log
    if (newContentStr !== oldContentStr) {
      const now = Date.now();
      const lastLogged = contentHistoryLastLogged.get(docId) || 0;

      if (now - lastLogged >= CONTENT_HISTORY_MIN_INTERVAL_MS) {
        // Log content change to document_history
        await pool.query(
          `INSERT INTO document_history (document_id, field, old_value, new_value, changed_by)
           VALUES ($1, 'content', $2, $3, $4)`,
          [docId, oldContentStr, newContentStr, editorPrincipal.kind === 'setup' ? createdBy : editorPrincipal.userId]
        );
        contentHistoryLastLogged.set(docId, now);
      }
    }
  }

  // Update properties with extracted values (null clears the property)
  // Note: 'plan' is the canonical field name (renamed from 'hypothesis' in migration 032)
  const updatedProps = {
    ...existingProps,
    plan: hypothesis,
    success_criteria: successCriteria,
    vision: vision,
    goals: goals,
  };

  // Persist yjs_state, content (JSON backup), and updated properties
  // The content column is kept in sync with yjs_state to serve as a fallback
  // and to support API reads that don't go through the collaboration server
  await pool.query(
    `UPDATE documents SET yjs_state = $1, content = $2, properties = $3, updated_at = now() WHERE id = $4`,
    [Buffer.from(state), JSON.stringify(content), JSON.stringify(updatedProps), docId]
  );
  await upsertDocumentSearchIndex(docId);
}

async function persistDocument(docName: string, doc: Y.Doc, principal?: Principal) {
  try {
    await persistDocumentStrict(docName, doc, principal);
  } catch (err) {
    console.error('Failed to persist document:', err);
  }
}

function trackFinalPersist(save: Promise<void>): void {
  finalPersistSaves.add(save);
  save.finally(() => {
    finalPersistSaves.delete(save);
  }).catch(() => undefined);
}

function schedulePersist(docName: string, doc: Y.Doc, principal?: Principal) {
  const existing = pendingSaves.get(docName);
  if (existing) clearTimeout(existing);
  if (principal) docLastEditorPrincipal.set(docName, principal);

  pendingSaves.set(docName, setTimeout(() => {
    void persistDocument(docName, doc, principal ?? docLastEditorPrincipal.get(docName));
    pendingSaves.delete(docName);
  }, 2000));
}

async function flushPendingSaves(): Promise<void> {
  const saves: Promise<void>[] = [];
  pendingSaves.forEach((pendingSave, docName) => {
    clearTimeout(pendingSave);
    pendingSaves.delete(docName);
    const doc = docs.get(docName);
    if (doc) saves.push(persistDocumentStrict(docName, doc, docLastEditorPrincipal.get(docName)));
  });
  await Promise.all(saves);
}

// Track which docs were loaded fresh from JSON (not from yjs_state)
// Browser should clear its IndexedDB cache when connecting to these docs
const freshFromJsonDocs = new Set<string>();

async function getOrCreateDoc(docName: string, principal?: Principal): Promise<Y.Doc> {
  let doc = docs.get(docName);
  if (doc) return doc;

  doc = new Y.Doc();
  docs.set(docName, doc);

  // Load existing state from database (all document types use the unified documents table)
  const docId = parseDocId(docName);

  try {
    const result = await pool.query(
      'SELECT yjs_state, content FROM documents WHERE id = $1',
      [docId]
    );

    const row = result.rows[0];
    const resolved = resolveInitialContent({
      content: row?.content ?? null,
      yjs_state: row?.yjs_state ?? null,
    });

    if (resolved.useYjsState && row?.yjs_state) {
      console.log(`[Collaboration] Loading ${docName} from yjs_state`);
      Y.applyUpdate(doc, row.yjs_state);
    } else if (resolved.docJson != null && Array.isArray(resolved.docJson.content)) {
      console.log(`[Collaboration] Converting JSON content to Yjs for ${docName}`);
      const fragment = doc.getXmlFragment('default');
      jsonToYjs(doc, fragment, resolved.docJson);
      console.log(
        `[Collaboration] Successfully converted content for ${docName}: ${resolved.docJson.content.length} top-level nodes`
      );
      freshFromJsonDocs.add(docName);
      schedulePersist(docName, doc, principal);
    } else {
      console.log(`[Collaboration] No content found for ${docName}, starting with empty document`);
    }
  } catch (err) {
    console.error(`[Collaboration] Failed to load document ${docName}:`, err);
  }

  // Set up persistence and broadcast on changes
  doc.on('update', (update: Uint8Array, origin: any) => {
    const originPrincipal = origin instanceof WebSocket ? conns.get(origin)?.principal : undefined;
    schedulePersist(docName, doc, originPrincipal);

    // Broadcast update to all other clients in this room (except sender)
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, messageSync);
    syncProtocol.writeUpdate(encoder, update);
    const message = encoding.toUint8Array(encoder);

    conns.forEach((conn, ws) => {
      if (conn.docName === docName && ws !== origin && ws.readyState === WebSocket.OPEN) {
        ws.send(message);
      }
    });
  });

  return doc;
}

function getAwareness(docName: string, doc: Y.Doc): awarenessProtocol.Awareness {
  let aw = awareness.get(docName);
  if (aw) return aw;

  aw = new awarenessProtocol.Awareness(doc);
  awareness.set(docName, aw);

  aw.on('update', ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }) => {
    const changedClients = added.concat(updated, removed);
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, messageAwareness);
    encoding.writeVarUint8Array(encoder, awarenessProtocol.encodeAwarenessUpdate(aw, changedClients));
    const message = encoding.toUint8Array(encoder);

    // Broadcast to all connections in this room
    conns.forEach((conn, ws) => {
      if (conn.docName === docName && ws.readyState === WebSocket.OPEN) {
        ws.send(message);
      }
    });
  });

  return aw;
}

function handleMessage(ws: WebSocket, message: Uint8Array, docName: string, doc: Y.Doc, aw: awarenessProtocol.Awareness) {
  try {
    const decoder = decoding.createDecoder(message);
    const messageType = decoding.readVarUint(decoder);

    switch (messageType) {
      case messageSync: {
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, messageSync);
        // Pass ws as origin so broadcast excludes the sender
        syncProtocol.readSyncMessage(decoder, encoder, doc, ws);

        if (encoding.length(encoder) > 1) {
          ws.send(encoding.toUint8Array(encoder));
        }
        break;
      }
      case messageAwareness: {
        const awarenessData = decoding.readVarUint8Array(decoder);

        // Extract the actual client's awarenessClientId from the update
        // This is critical for proper cleanup on disconnect - the server was
        // previously storing doc.clientID (server's ID) instead of the client's
        // actual awareness clientID, causing stale states on page refresh.
        // Format: [numStates, ...for each: clientId, clock, stateJson]
        const conn = conns.get(ws);
        if (conn) {
          const updateDecoder = decoding.createDecoder(awarenessData);
          const numStates = decoding.readVarUint(updateDecoder);
          if (numStates > 0) {
            const clientId = decoding.readVarUint(updateDecoder);
            conn.awarenessClientId = clientId;
          }
        }

        awarenessProtocol.applyAwarenessUpdate(aw, awarenessData, ws);
        break;
      }
      default:
        ws.close(1003, 'Unsupported message type');
    }
  } catch {
    ws.close(1003, 'Invalid collaboration message');
  }
}

// Validate session from cookie header - returns userId/workspaceId or null
async function validateWebSocketSession(request: IncomingMessage): Promise<Extract<Principal, { kind: 'session' }> | null> {
  const cookieHeader = request.headers.cookie;
  if (!cookieHeader) return null;

  const cookies = cookie.parse(cookieHeader);
  const sessionId = cookies.session_id;
  if (!sessionId) return null;

  try {
    const validation = await validateAuthenticatedSession(sessionId, {
      updateActivity: true,
      userAgent: Array.isArray(request.headers['user-agent']) ? request.headers['user-agent'][0] : request.headers['user-agent'] || null,
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

// Check if user can access a document for collaboration (visibility + accountability)
async function canAccessDocumentForCollab(docId: string, principal: Principal): Promise<boolean> {
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

function evictCachedDocsIfNeeded(): void {
  if (docs.size <= RATE_LIMIT.MAX_CACHED_DOCS) return;
  for (const [docName] of docs) {
    let hasConnections = false;
    conns.forEach((conn) => {
      if (conn.docName === docName) hasConnections = true;
    });
    if (!hasConnections) {
      removeCachedDocState(docName);
      if (docs.size <= RATE_LIMIT.MAX_CACHED_DOCS) return;
    }
  }
}

function removeCachedDocState(docName: string): void {
  docs.delete(docName);
  awareness.delete(docName);
  freshFromJsonDocs.delete(docName);
  docLastEditorPrincipal.delete(docName);
  const timer = docEvictionTimers.get(docName);
  if (timer) clearTimeout(timer);
  docEvictionTimers.delete(docName);
  contentHistoryLastLogged.delete(parseDocId(docName));
}

function canAcceptCachedDoc(docName: string): boolean {
  if (docs.has(docName) || docs.size < RATE_LIMIT.MAX_CACHED_DOCS) return true;

  for (const [cachedDocName] of docs) {
    let hasConnections = false;
    conns.forEach((conn) => {
      if (conn.docName === cachedDocName) hasConnections = true;
    });
    if (!hasConnections) {
      removeCachedDocState(cachedDocName);
      break;
    }
  }

  return docs.has(docName) || docs.size < RATE_LIMIT.MAX_CACHED_DOCS;
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

/**
 * Handle document visibility change.
 * When a document's visibility changes (especially to 'private'),
 * we need to disconnect any users who no longer have access.
 *
 * @param docId - The document ID that changed visibility
 * @param newVisibility - The new visibility value ('private' or 'workspace')
 * @param creatorId - The user ID of the document creator
 */

/**
 * Handle document conversion.
 * When a document is converted to a different type (issue→project or project→issue),
 * notify all collaborators and redirect them to the new document.
 *
 * @param oldDocId - The original document ID that was converted
 * @param newDocId - The new document ID
 * @param oldDocType - The original document type ('issue' or 'project')
 * @param newDocType - The new document type ('issue' or 'project')
 */
/**
 * Invalidate the in-memory cache for a document.
 * Call this when document content is updated via REST API to ensure
 * the collaboration server reloads from database on next connection.
 *
 * @param docId - The document ID to invalidate
 */
export function invalidateDocumentCache(docId: string): void {
  // Find all doc names that match this docId (could be "wiki:uuid", "issue:uuid", etc.)
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
    // Close any active connections with "content updated" code
    const connectionsToClose: WebSocket[] = [];
    conns.forEach((conn, ws) => {
      if (conn.docName === docName) {
        connectionsToClose.push(ws);
      }
    });

    for (const ws of connectionsToClose) {
      if (ws.readyState === WebSocket.OPEN) {
        // Close with custom code 4101 (content updated via API)
        // Frontend should handle this by reconnecting to get fresh content
        ws.close(COLLAB_CLOSE_CODE_CONTENT_UPDATE, 'Content updated');
      }
    }

    // Clear any pending saves
    const pendingSave = pendingSaves.get(docName);
    if (pendingSave) {
      clearTimeout(pendingSave);
      pendingSaves.delete(docName);
    }

    // Remove from cache - next connection will reload from database
    docs.delete(docName);
    awareness.delete(docName);

    console.log(`[Collaboration] Invalidated cache for ${docName}`);
  }
}

export function handleDocumentConversion(
  oldDocId: string,
  newDocId: string,
  oldDocType: ConversionDocumentType,
  newDocType: ConversionDocumentType
): void {
  // Find all connections to this document (across all doc types)
  const connectionsToNotify: Array<{ ws: WebSocket; conn: NonNullable<ReturnType<typeof conns.get>> }> = [];

  conns.forEach((conn, ws) => {
    const connDocId = parseDocId(conn.docName);
    if (connDocId === oldDocId) {
      connectionsToNotify.push({ ws, conn });
    }
  });

  if (connectionsToNotify.length === 0) {
    return; // No active connections to this document
  }

  console.log(`[Collaboration] Document ${oldDocId} converted to ${newDocType} (${newDocId}), notifying ${connectionsToNotify.length} collaborators`);

  // Put conversion info in close reason (JSON fits within 123-byte limit)
  const closeReason = JSON.stringify({
    newDocId,
    newDocType,
  });

  for (const { ws } of connectionsToNotify) {
    if (ws.readyState === WebSocket.OPEN) {
      // Close with custom code 4100 (document converted) and JSON reason
      ws.close(COLLAB_CLOSE_CODE_CONVERSION, closeReason);
    }
  }
}

export async function handleVisibilityChange(
  docId: string,
  newVisibility: 'private' | 'workspace',
  creatorId: string
): Promise<void> {
  // Find all connections to this document (across all doc types)
  const connectionsToCheck: Array<{ ws: WebSocket; conn: NonNullable<ReturnType<typeof conns.get>> }> = [];

  conns.forEach((conn, ws) => {
    const connDocId = parseDocId(conn.docName);
    if (connDocId === docId) {
      connectionsToCheck.push({ ws, conn });
    }
  });

  if (connectionsToCheck.length === 0) {
    return; // No active connections to this document
  }

  console.log(`[Collaboration] Visibility change for doc ${docId} to '${newVisibility}', checking ${connectionsToCheck.length} connections`);

  // For private documents, only creator and admins can access
  // For workspace documents, all workspace members can access (no action needed)
  if (newVisibility === 'workspace') {
    return; // All workspace members can access, no need to disconnect anyone
  }

  // For private documents, check each connection
  for (const { ws, conn } of connectionsToCheck) {
    // Creator always has access
    if (conn.userId === creatorId) {
      continue;
    }

    // Check if user is admin
    const canAccess = await canAccessDocumentForCollab(docId, conn.principal);

    if (!canAccess) {
      console.log(`[Collaboration] Disconnecting user ${conn.userId} from private doc ${docId}`);

      // Close with code 4403 (custom code for "access revoked")
      // Frontend should handle this code and show appropriate message
      ws.close(COLLAB_CLOSE_CODE_ACCESS_REVOKED, 'Document access revoked');
    }
  }
}

/**
 * Broadcast a custom event to all WebSocket connections for a specific user.
 * Used for real-time notifications like accountability updates.
 * Sends to both document collaboration connections and global event connections.
 *
 * @param userId - The user ID to broadcast to
 * @param eventType - The event type (e.g., 'accountability:updated')
 * @param data - Optional event data payload
 */
export function broadcastToUser(userId: string, eventType: string, data?: Record<string, unknown>): void {
  const payload = JSON.stringify({ type: eventType, data: data || {} });

  // For events connections, send as plain JSON (they're dedicated for events)
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

// DDoS protection: Max WebSocket message size (10MB, matches REST API limit)
const MAX_WS_MESSAGE_SIZE = 10 * 1024 * 1024;

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
  collaborationShuttingDown = false;
  const connectionAttemptCleanupInterval = setInterval(cleanupOldConnectionAttempts, 30_000);
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_WS_MESSAGE_SIZE });
  const eventsWss = new WebSocketServer({ noServer: true, maxPayload: MAX_WS_MESSAGE_SIZE });

  const handleUpgrade = async (request: IncomingMessage, socket: import('net').Socket, head: Buffer) => {
    if (collaborationShuttingDown) {
      socket.destroy();
      return;
    }

    const url = new URL(request.url || '', `http://${request.headers.host}`);

    // Handle /events WebSocket for real-time notifications
    if (url.pathname === '/events') {
      // Rate limit check
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

      // Validate session
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

    // Only handle /collaboration/* paths
    if (!url.pathname.startsWith('/collaboration/')) {
      socket.destroy();
      return;
    }

    // Rate limit check: prevent connection floods from single IP
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

    // CRITICAL: Validate session before allowing WebSocket connection
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

    // Track this connection with user info for visibility change handling
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

    // If this doc was loaded fresh from JSON (API-created or API-updated content),
    // tell the browser to clear its IndexedDB cache before sync to prevent stale content merge
    if (freshFromJsonDocs.has(docName)) {
      console.log(`[Collaboration] Sending cache clear signal for ${docName} (loaded fresh from JSON)`);
      const clearCacheEncoder = encoding.createEncoder();
      encoding.writeVarUint(clearCacheEncoder, messageClearCache);
      ws.send(encoding.toUint8Array(clearCacheEncoder));
      // Clear the flag after first client connects - subsequent connections to same doc don't need this
      // (they'll sync with the already-converted yjs state once persisted)
      freshFromJsonDocs.delete(docName);
    }

    // Send sync step 1
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, messageSync);
    syncProtocol.writeSyncStep1(encoder, doc);
    ws.send(encoding.toUint8Array(encoder));

    // Send current awareness state
    const awarenessStates = aw.getStates();
    if (awarenessStates.size > 0) {
      const awarenessEncoder = encoding.createEncoder();
      encoding.writeVarUint(awarenessEncoder, messageAwareness);
      encoding.writeVarUint8Array(awarenessEncoder, awarenessProtocol.encodeAwarenessUpdate(aw, Array.from(awarenessStates.keys())));
      ws.send(encoding.toUint8Array(awarenessEncoder));
    }

    ws.on('message', (data: Buffer) => {
      // DDoS protection: Defense-in-depth size check (WS server also enforces maxPayload)
      if (data.length > MAX_WS_MESSAGE_SIZE) {
        ws.close(1009, 'Message too large');
        return;
      }

      // Rate limit messages to prevent message floods
      if (isMessageRateLimited(ws)) {
        // DDoS protection: Track violations and apply progressive penalties
        const violations = (rateLimitViolations.get(ws) || 0) + 1;
        rateLimitViolations.set(ws, violations);

        // After repeated violations, terminate the connection
        if (violations >= RATE_LIMIT_VIOLATION_THRESHOLD) {
          ws.close(1008, 'Rate limit exceeded');
          return;
        }

        // Drop message silently - client will retry via Yjs sync protocol
        return;
      }

      // Reset violation count on successful (non-rate-limited) messages
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
      // Clean up rate limiting data for this connection
      messageTimestamps.delete(ws);
      rateLimitViolations.delete(ws);

      // Clean up if no more connections to this doc
      let hasConnections = false;
      conns.forEach((c) => {
        if (c.docName === docName) hasConnections = true;
      });

      if (!hasConnections) {
        // Final persist before cleanup
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

        // Keep doc in memory for a bit in case of quick reconnect
        if (collaborationShuttingDown) return;
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

  // Handle events WebSocket connections (for real-time notifications)
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

    // Send initial connected message
    ws.send(JSON.stringify({ type: 'connected', data: {} }));

    // Handle ping/pong for keepalive with rate limiting
    ws.on('message', (data: Buffer) => {
      // DDoS protection: Rate limit events WebSocket messages
      if (isMessageRateLimited(ws)) {
        const violations = (rateLimitViolations.get(ws) || 0) + 1;
        rateLimitViolations.set(ws, violations);

        if (violations >= RATE_LIMIT_VIOLATION_THRESHOLD) {
          console.log(`[Events] Rate limit violations exceeded for user ${sessionData.userId}, closing connection`);
          ws.close(1008, 'Rate limit exceeded');
        }
        return;
      }

      // Reset violations on successful message
      rateLimitViolations.delete(ws);
      recordMessage(ws);

      try {
        const message = JSON.parse(data.toString());
        if (message.type === 'ping') {
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
      rateLimitViolations.delete(ws);
      messageTimestamps.delete(ws);
      console.log(`[Events] User ${sessionData.userId} disconnected (${eventConns.size} total connections)`);
    });
  });

  console.log('Yjs collaboration server attached');
  console.log('Events WebSocket server attached');

  return async () => {
    collaborationShuttingDown = true;
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

    connectionAttempts.clear();
    messageTimestamps.clear();
    rateLimitViolations.clear();
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
