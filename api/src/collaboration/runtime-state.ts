import { WebSocket } from 'ws';
import * as Y from 'yjs';
import * as awarenessProtocol from 'y-protocols/awareness';
import { parseDocumentIdFromRoomName } from '@ship/shared';
import type { Principal } from '../security/principal.js';

function readPositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export const RATE_LIMIT = {
  CONNECTION_WINDOW_MS: 60_000,
  MAX_CONNECTIONS_PER_IP: readPositiveIntEnv('COLLAB_MAX_CONNECTIONS_PER_IP', 30),
  MAX_CONNECTIONS_PER_USER: readPositiveIntEnv('COLLAB_MAX_CONNECTIONS_PER_USER', 20),
  MAX_CONNECTIONS_PER_WORKSPACE: readPositiveIntEnv('COLLAB_MAX_CONNECTIONS_PER_WORKSPACE', 200),
  MAX_CACHED_DOCS: readPositiveIntEnv('COLLAB_MAX_CACHED_DOCS', 200),
  SESSION_REVALIDATION_MS: readPositiveIntEnv('COLLAB_SESSION_REVALIDATION_MS', 60_000),
  MESSAGE_WINDOW_MS: 1_000,
  MAX_MESSAGES_PER_SECOND: 50,
};

export const RATE_LIMIT_VIOLATION_THRESHOLD = 50;

const connectionAttempts = new Map<string, number[]>();
const messageTimestamps = new Map<WebSocket, number[]>();
export const rateLimitViolations = new Map<WebSocket, number>();

export const docs = new Map<string, Y.Doc>();
export const awareness = new Map<string, awarenessProtocol.Awareness>();
export const conns = new Map<
  WebSocket,
  {
    docName: string;
    awarenessClientId: number;
    userId: string;
    workspaceId: string;
    principal: Principal;
    revalidateTimer?: NodeJS.Timeout;
  }
>();
export const eventConns = new Map<
  WebSocket,
  { userId: string; workspaceId: string; principal: Principal; revalidateTimer?: NodeJS.Timeout }
>();

export const pendingSaves = new Map<string, NodeJS.Timeout>();
export const docLastEditorPrincipal = new Map<string, Principal>();
export const contentHistoryLastLogged = new Map<string, number>();
export const CONTENT_HISTORY_MIN_INTERVAL_MS = 60_000;
export const docEvictionTimers = new Map<string, NodeJS.Timeout>();
export const finalPersistSaves = new Set<Promise<void>>();
export const freshFromJsonDocs = new Set<string>();

let collaborationShuttingDown = false;

export function getCollaborationShuttingDown(): boolean {
  return collaborationShuttingDown;
}

export function setCollaborationShuttingDown(value: boolean): void {
  collaborationShuttingDown = value;
}

export function parseDocId(docName: string): string {
  return parseDocumentIdFromRoomName(docName);
}

export function cleanupOldConnectionAttempts(): void {
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

export function isConnectionRateLimited(ip: string): boolean {
  const now = Date.now();
  const attempts = connectionAttempts.get(ip) || [];
  const recentAttempts = attempts.filter(t => now - t < RATE_LIMIT.CONNECTION_WINDOW_MS);
  return recentAttempts.length >= RATE_LIMIT.MAX_CONNECTIONS_PER_IP;
}

export function recordConnectionAttempt(ip: string): void {
  const now = Date.now();
  const attempts = connectionAttempts.get(ip) || [];
  attempts.push(now);
  const recentAttempts = attempts.filter(t => now - t < RATE_LIMIT.CONNECTION_WINDOW_MS);
  connectionAttempts.set(ip, recentAttempts);
}

export function isMessageRateLimited(ws: WebSocket): boolean {
  const now = Date.now();
  const timestamps = messageTimestamps.get(ws) || [];
  const recentMessages = timestamps.filter(t => now - t < RATE_LIMIT.MESSAGE_WINDOW_MS);
  return recentMessages.length >= RATE_LIMIT.MAX_MESSAGES_PER_SECOND;
}

export function recordMessage(ws: WebSocket): void {
  const now = Date.now();
  const timestamps = messageTimestamps.get(ws) || [];
  timestamps.push(now);
  const recentTimestamps = timestamps.filter(t => now - t < RATE_LIMIT.MESSAGE_WINDOW_MS);
  messageTimestamps.set(ws, recentTimestamps);
}

export function clearConnectionRateLimitState(ws: WebSocket): void {
  messageTimestamps.delete(ws);
  rateLimitViolations.delete(ws);
}

export function clearRateLimitMaps(): void {
  connectionAttempts.clear();
  messageTimestamps.clear();
  rateLimitViolations.clear();
}

export function removeCachedDocState(docName: string): void {
  docs.delete(docName);
  awareness.delete(docName);
  freshFromJsonDocs.delete(docName);
  docLastEditorPrincipal.delete(docName);
  const timer = docEvictionTimers.get(docName);
  if (timer) clearTimeout(timer);
  docEvictionTimers.delete(docName);
  contentHistoryLastLogged.delete(parseDocId(docName));
}

export function evictCachedDocsIfNeeded(): void {
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

export function canAcceptCachedDoc(docName: string): boolean {
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
