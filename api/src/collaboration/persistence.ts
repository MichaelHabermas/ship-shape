import { WebSocket } from 'ws';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import {
  COLLAB_MESSAGE_SYNC as messageSync,
  COLLAB_MESSAGE_AWARENESS as messageAwareness,
} from '@ship/shared';
import { pool } from '../db/client.js';
import { extractHypothesisFromContent, extractSuccessCriteriaFromContent, extractVisionFromContent, extractGoalsFromContent } from '../utils/extractHypothesis.js';
import { stampWeeklyAccountabilitySubmittedAt } from '../utils/document-governance.js';
import { yjsToJson, jsonToYjs } from '../utils/yjsConverter.js';
import { resolveInitialContent } from '../db/document-content-codec.js';
import { upsertDocumentSearchIndex } from '../utils/tiptap-search.js';
import { authorize } from '../security/capabilities.js';
import type { Principal } from '../security/principal.js';
import {
  conns,
  docs,
  awareness,
  pendingSaves,
  docLastEditorPrincipal,
  contentHistoryLastLogged,
  CONTENT_HISTORY_MIN_INTERVAL_MS,
  finalPersistSaves,
  freshFromJsonDocs,
  parseDocId,
} from './runtime-state.js';

export async function persistDocumentStrict(docName: string, doc: Y.Doc, principal?: Principal) {
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

  const fragment = doc.getXmlFragment('default');
  const content = yjsToJson(fragment);

  const hypothesis = extractHypothesisFromContent(content);
  const successCriteria = extractSuccessCriteriaFromContent(content);
  const vision = extractVisionFromContent(content);
  const goals = extractGoalsFromContent(content);

  const existingResult = await pool.query<{
    properties: Record<string, unknown> | null;
    document_type: string;
    content: unknown;
    created_by: string;
  }>(
    'SELECT properties, document_type, content, created_by FROM documents WHERE id = $1',
    [docId]
  );
  const existingRow = existingResult.rows[0];
  const existingProps = existingRow?.properties ?? {};
  const documentType = existingRow?.document_type;
  const existingContent = existingRow?.content;
  const createdBy = existingRow?.created_by;

  if ((documentType === 'weekly_plan' || documentType === 'weekly_retro') && createdBy) {
    const newContentStr = JSON.stringify(content);
    const oldContentStr = existingContent ? JSON.stringify(existingContent) : null;

    if (newContentStr !== oldContentStr) {
      const now = Date.now();
      const lastLogged = contentHistoryLastLogged.get(docId) || 0;

      if (now - lastLogged >= CONTENT_HISTORY_MIN_INTERVAL_MS) {
        await pool.query(
          `INSERT INTO document_history (document_id, field, old_value, new_value, changed_by)
           VALUES ($1, 'content', $2, $3, $4)`,
          [docId, oldContentStr, newContentStr, editorPrincipal.kind === 'setup' ? createdBy : editorPrincipal.userId]
        );
        contentHistoryLastLogged.set(docId, now);
      }
    }
  }

  const contentChanged =
    JSON.stringify(content) !== (existingContent ? JSON.stringify(existingContent) : null);

  const updatedProps = stampWeeklyAccountabilitySubmittedAt(
    documentType,
    {
      ...existingProps,
      plan: hypothesis,
      success_criteria: successCriteria,
      vision: vision,
      goals: goals,
    },
    contentChanged
  );

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

export function trackFinalPersist(save: Promise<void>): void {
  finalPersistSaves.add(save);
  save.finally(() => {
    finalPersistSaves.delete(save);
  }).catch(() => undefined);
}

export function schedulePersist(docName: string, doc: Y.Doc, principal?: Principal) {
  const existing = pendingSaves.get(docName);
  if (existing) clearTimeout(existing);
  if (principal) docLastEditorPrincipal.set(docName, principal);

  pendingSaves.set(docName, setTimeout(() => {
    void persistDocument(docName, doc, principal ?? docLastEditorPrincipal.get(docName));
    pendingSaves.delete(docName);
  }, 2000));
}

export async function flushPendingSaves(): Promise<void> {
  const saves: Promise<void>[] = [];
  pendingSaves.forEach((pendingSave, docName) => {
    clearTimeout(pendingSave);
    pendingSaves.delete(docName);
    const doc = docs.get(docName);
    if (doc) saves.push(persistDocumentStrict(docName, doc, docLastEditorPrincipal.get(docName)));
  });
  await Promise.all(saves);
}

export async function getOrCreateDoc(docName: string, principal?: Principal): Promise<Y.Doc> {
  let doc = docs.get(docName);
  if (doc) return doc;

  doc = new Y.Doc();
  docs.set(docName, doc);

  const docId = parseDocId(docName);

  try {
    const result = await pool.query<{ yjs_state: Buffer | null; content: unknown }>(
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
      Y.applyUpdate(doc, new Uint8Array(row.yjs_state));
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

  doc.on('update', (update: Uint8Array, origin: unknown) => {
    const originPrincipal = origin instanceof WebSocket ? conns.get(origin)?.principal : undefined;
    schedulePersist(docName, doc, originPrincipal);

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

export function getAwareness(docName: string, doc: Y.Doc): awarenessProtocol.Awareness {
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

    conns.forEach((conn, ws) => {
      if (conn.docName === docName && ws.readyState === WebSocket.OPEN) {
        ws.send(message);
      }
    });
  });

  return aw;
}

export function handleMessage(ws: WebSocket, message: Uint8Array, docName: string, doc: Y.Doc, aw: awarenessProtocol.Awareness) {
  try {
    const decoder = decoding.createDecoder(message);
    const messageType = decoding.readVarUint(decoder);

    switch (messageType) {
      case messageSync: {
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, messageSync);
        syncProtocol.readSyncMessage(decoder, encoder, doc, ws);

        if (encoding.length(encoder) > 1) {
          ws.send(encoding.toUint8Array(encoder));
        }
        break;
      }
      case messageAwareness: {
        const awarenessData = decoding.readVarUint8Array(decoder);

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
