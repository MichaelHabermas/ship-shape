# Collaboration Module

Real-time collaborative editing system using Yjs CRDTs synchronized via WebSocket.

## Overview

Ship uses Yjs (a CRDT implementation) for conflict-free real-time collaboration. Multiple users can edit the same document simultaneously with automatic conflict resolution. Changes are synchronized via WebSocket and persisted to PostgreSQL.

**Key characteristics:**
- Offline-first: IndexedDB caches content locally for instant loading
- Eventual consistency: Yjs CRDTs guarantee all clients converge to same state
- Low latency: Changes broadcast immediately to all connected clients
- Automatic reconnection: y-websocket handles connection drops gracefully

## Architecture

### Server

**File:** `api/src/collaboration/index.ts`

The collaboration server:
1. Handles WebSocket upgrade requests at `/collaboration/:room`
2. Validates session cookies before allowing connections
3. Manages Yjs document instances in memory
4. Broadcasts updates to all clients in the same room
5. Persists document state to PostgreSQL on changes (debounced 2s)

**Key data structures:**
```typescript
// In-memory document storage
const docs = new Map<string, Y.Doc>();
const awareness = new Map<string, Awareness>();
const conns = new Map<WebSocket, { docName, awarenessClientId, userId, workspaceId }>();
```

### Client

**File:** `web/src/hooks/useCollabSession.ts`

The `useCollabSession` hook (used by `Editor.tsx`) owns transport only:
- `@tiptap/extension-collaboration` / `@tiptap/extension-collaboration-cursor` — configured in `Editor.tsx`
- `y-websocket` — WebSocket provider for Yjs sync
- `y-indexeddb` — Local persistence for offline-tolerant loading

**Connection setup:**
```typescript
// IndexedDB key: ship-{documentType}-{documentId}
const cacheKey = `ship-${documentType}-${documentId}`;
const indexeddbProvider = new IndexeddbPersistence(cacheKey, ydoc);

// WebSocket URL derived from VITE_API_URL (falls back to same host)
const apiUrl = import.meta.env.VITE_API_URL ?? '';
const wsUrl = apiUrl
  ? apiUrl.replace(/^http/, 'ws') + '/collaboration'
  : `${wsProtocol}//${window.location.host}/collaboration`;

// Room name: {documentType}:{documentId} (legacy "doc:" accepted for wiki only)
const roomName = buildCollaborationRoomName(documentType, documentId);
const wsProvider = new WebsocketProvider(wsUrl, roomName, ydoc);
```

When the browser is offline or the WebSocket drops, IndexedDB cache keeps the editor usable; sync status shows **Cached** until the connection restores.

## WebSocket Protocol

### Connection URL

```
/collaboration/:docType:docId

Examples:
  /collaboration/wiki:550e8400-e29b-41d4-a716-446655440000
  /collaboration/issue:7c9e6679-7425-40de-944b-e07fc1f90ae7
  /collaboration/program:a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11
```

**Room name format:** `{document_type}:{uuid}` where document_type is `wiki`, `issue`, `program`, `project`, or `sprint` (historical name for weeks). Legacy `doc:` prefix is accepted for wiki documents only.

### Message Types

Three message types (defined in `shared/src/collab-protocol.ts`):
```typescript
const messageSync = 0;           // Yjs sync protocol messages
const messageAwareness = 1;      // Cursor positions, user presence
const messageClearCache = 3;     // Server tells client to clear stale IndexedDB cache
```

**Clear-cache protocol (type 3):**
- Sent when REST API updates document content while clients are connected
- Client clears local Yjs fragment and IndexedDB entry, then reconnects for fresh state
- Paired with WebSocket close code `4101` on active connections

**Sync Protocol Flow:**
1. Client connects, server sends `syncStep1` (state vector)
2. Client responds with `syncStep2` (missing updates)
3. Subsequent changes use `update` messages
4. Updates broadcast to all other clients in room

**Awareness Protocol:**
- Tracks cursor positions, selections, user info
- Broadcasts `{added, updated, removed}` client arrays
- Cleaned up automatically on disconnect

### Connection Lifecycle

```
Client                                    Server
   |                                         |
   |--- HTTP Upgrade /collaboration/wiki:id --|
   |                                         |
   |<-- [Auth check: validate session] ------|
   |<-- [Access check: document visibility] -|
   |                                         |
   |<------ 101 Switching Protocols ---------|
   |                                         |
   |<------ syncStep1 (state vector) --------|
   |------- syncStep2 (updates) ------------>|
   |<------ awareness (other users) ---------|
   |                                         |
   |<====== bidirectional sync ==============>|
   |                                         |
   |--- close ------>|                       |
   |                 |-- cleanup awareness --|
   |                 |-- persist if last ----|
   |                 |-- 30s delay cleanup --|
```

## Document Persistence

### Database Schema

```sql
-- In documents table (api/src/db/schema.sql)
yjs_state BYTEA,  -- Binary Yjs state for collaboration
content JSONB,    -- TipTap JSON (for non-collab access, search indexing)
```

### Persistence Flow

1. **On document change:** Debounced 2-second timer starts
2. **When timer fires:**
   - Encode Yjs state as binary: `Y.encodeStateAsUpdate(doc)`
   - Convert Yjs to TipTap JSON via `yjsToJson()`
   - Extract structured data (hypothesis, success criteria, vision, goals)
   - Update `yjs_state`, `properties`, and `updated_at` in database

### Conversion Functions

**`yjsToJson(fragment: Y.XmlFragment): TipTapJSON`**

Converts Yjs XmlFragment to TipTap JSON format:
```typescript
// Yjs stores content as XmlFragment with XmlElement/XmlText nodes
// Output: { type: 'doc', content: [{ type: 'paragraph', content: [...] }] }
```

**`jsonToYjs(doc: Y.Doc, fragment: Y.XmlFragment, content: TipTapJSON)`**

Converts TipTap JSON to Yjs XmlFragment (for seeded/migrated documents):
```typescript
// Used when loading a document that has JSON content but no yjs_state
// Runs inside Yjs transaction for proper CRDT integration
```

### Document Loading Priority

```typescript
async function getOrCreateDoc(docName: string): Promise<Y.Doc> {
  // 1. Check memory cache
  if (docs.has(docName)) return docs.get(docName);

  // 2. Create new Y.Doc
  const doc = new Y.Doc();

  // 3. Load from database
  //    Priority: yjs_state (binary) > content (JSON fallback)
  if (result.rows[0]?.yjs_state) {
    Y.applyUpdate(doc, result.rows[0].yjs_state);
  } else if (result.rows[0]?.content) {
    jsonToYjs(doc, fragment, jsonContent);
    schedulePersist(docName, doc); // Save converted state
  }

  return doc;
}
```

## Rate Limiting

### Connection Rate Limiting

```typescript
const RATE_LIMIT = {
  CONNECTION_WINDOW_MS: 60_000,  // 1 minute window
  MAX_CONNECTIONS_PER_IP: 30,   // 30 connections per minute per IP
};
```

- Tracked per IP address using sliding window
- Returns `429 Too Many Requests` when exceeded
- Old entries cleaned up every 30 seconds

### Message Rate Limiting

```typescript
const RATE_LIMIT = {
  MESSAGE_WINDOW_MS: 1_000,      // 1 second window
  MAX_MESSAGES_PER_SECOND: 50,  // 50 messages per second per connection
};
```

- Tracked per WebSocket connection
- Excess messages silently dropped (Yjs will retry via sync protocol)
- Prevents message flood attacks

## Session Validation

### On Connection

```typescript
async function validateWebSocketSession(request: IncomingMessage): Promise<SessionData | null> {
  // 1. Extract session_id from cookie header
  const cookies = cookie.parse(request.headers.cookie);
  const sessionId = cookies.session_id;

  // 2. Look up session in database
  const session = await pool.query('SELECT ... FROM sessions WHERE id = $1', [sessionId]);

  // 3. Check absolute timeout (12 hours since creation)
  if (sessionAgeMs > ABSOLUTE_SESSION_TIMEOUT_MS) {
    await pool.query('DELETE FROM sessions WHERE id = $1', [sessionId]);
    return null;
  }

  // 4. Check inactivity timeout (15 minutes since last activity)
  if (inactivityMs > SESSION_TIMEOUT_MS) {
    await pool.query('DELETE FROM sessions WHERE id = $1', [sessionId]);
    return null;
  }

  // 5. Update last_activity timestamp
  await pool.query('UPDATE sessions SET last_activity = $1 WHERE id = $2', [now, sessionId]);

  return { userId, workspaceId };
}
```

### Session Timeout Constants

From `shared/src/constants.ts`:
```typescript
export const SESSION_TIMEOUT_MS = 15 * 60 * 1000;      // 15 minutes inactivity
export const ABSOLUTE_SESSION_TIMEOUT_MS = 12 * 60 * 60 * 1000;  // 12 hours absolute
```

### Document Access Check

```typescript
async function canAccessDocumentForCollab(docId, userId, workspaceId): Promise<boolean> {
  // Access granted if:
  // - Document visibility is 'workspace', OR
  // - User is the document creator, OR
  // - User is workspace admin
}
```

## Key Functions

### `setupCollaboration(server: Server)`

Main entry point. Attaches WebSocket upgrade handler to HTTP server:
```typescript
export function setupCollaboration(server: Server) {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', async (request, socket, head) => {
    // 1. Check path starts with /collaboration/
    // 2. Rate limit check
    // 3. Validate session (returns 401 if invalid)
    // 4. Check document access (returns 403 if denied)
    // 5. Upgrade to WebSocket
  });

  wss.on('connection', async (ws, request, docName, sessionData) => {
    // 1. Get or create Y.Doc for this room
    // 2. Get or create Awareness instance
    // 3. Send initial sync state
    // 4. Set up message handlers
    // 5. Set up close handler (cleanup)
  });
}
```

### `persistDocument(docName: string, doc: Y.Doc)`

Saves document state to PostgreSQL:
- Encodes Yjs state as binary buffer
- Converts to TipTap JSON for `content` column
- Extracts hypothesis/criteria from structured headings
- Merges extracted data into `properties` JSONB

### `validateWebSocketSession(request: IncomingMessage)`

Validates session before allowing WebSocket connection:
- Parses cookie header to extract `session_id`
- Queries sessions table
- Enforces inactivity timeout (15 min) and absolute timeout (12 hr)
- Updates `last_activity` on valid session

### `handleVisibilityChange(docId, newVisibility, creatorId)`

Called when document visibility changes to `private`:
- Finds all active connections to the document
- Checks if each connected user still has access
- Disconnects users who lost access with code `4403`

### `handleDocumentConversion(oldDocId, newDocId, oldDocType, newDocType)`

Called when a document is converted (issue to project or vice versa):
- Finds all active connections to the old document
- Closes connections with code `4100` and JSON payload containing new ID/type
- Client receives close event and can redirect to new document

## Custom WebSocket Close Codes

| Code | Meaning | Client Action |
|------|---------|---------------|
| 4403 | Access revoked | Show alert, navigate away |
| 4100 | Document converted | Redirect to new document |
| 4101 | Content updated via API | Clear IndexedDB cache, reconnect |

## Sync Status Indicators

The Editor shows connection status to users:

| Status | Color | Meaning |
|--------|-------|---------|
| Saved | Green | Connected and synced with server |
| Cached | Blue | Working from local cache (WebSocket connecting) |
| Saving | Yellow | Connection in progress |
| Offline | Red | Browser offline or connection lost |

## Cleanup Behavior

When last client disconnects from a room:
1. Pending saves are flushed immediately
2. Document kept in memory for 30 seconds (quick reconnect grace period)
3. After 30 seconds with no connections, document and awareness removed from memory
4. Next connection will reload from database

## Common Issues

### Cross-Document Contamination

**Problem:** Navigating between documents shows wrong content.

**Cause:** Y.Doc instance reused across different documentIds.

**Solution:** Create new Y.Doc per documentId using `useMemo`:
```typescript
// CRITICAL: New Y.Doc for each documentId
const ydoc = useMemo(() => new Y.Doc(), [documentId]);
```

### IndexedDB Cache Shows Stale Content

**Problem:** Cached content shows briefly before server content loads.

**Cause:** Normal behavior - IndexedDB loads before WebSocket syncs.

**Solution:** This is expected. The "Cached" indicator shows during this state.

### Session Timeout During Editing

**Problem:** WebSocket disconnects during long editing session.

**Cause:** 15-minute inactivity timeout on server.

**Solution:** Frontend must call `/api/auth/refresh` periodically. The `useSessionTimeout` hook handles this.
