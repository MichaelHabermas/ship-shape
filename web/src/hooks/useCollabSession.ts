import { useEffect, useRef, useState } from 'react';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { IndexeddbPersistence } from 'y-indexeddb';
import {
  COLLAB_MESSAGE_CLEAR_CACHE,
  COLLAB_CLOSE_CODE_ACCESS_REVOKED,
  COLLAB_CLOSE_CODE_CONVERSION,
  COLLAB_CLOSE_CODE_CONTENT_UPDATE,
  buildCollaborationRoomName,
  type ConversionDocumentType,
} from '@ship/shared';

export type CollabSyncStatus = 'connecting' | 'cached' | 'synced' | 'disconnected';

export interface CollabUser {
  name: string;
  color: string;
}

interface DocumentConversionInfo {
  newDocId?: string;
  newDocType?: ConversionDocumentType;
}

interface AwarenessState {
  user?: unknown;
}

function parseDocumentConversionInfo(reason: string): DocumentConversionInfo | null {
  try {
    const parsed: unknown = JSON.parse(reason || '{}');
    if (typeof parsed !== 'object' || parsed === null) return null;
    const obj = parsed as Record<string, unknown>;
    const newDocId = typeof obj.newDocId === 'string' ? obj.newDocId : undefined;
    const newDocType =
      obj.newDocType === 'issue' || obj.newDocType === 'project' ? obj.newDocType : undefined;
    return { newDocId, newDocType };
  } catch {
    return null;
  }
}

function isCollabUser(value: unknown): value is CollabUser {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  return typeof obj.name === 'string' && typeof obj.color === 'string';
}

export interface UseCollabSessionOptions {
  documentId: string;
  /** Authoritative document type for room naming (preferred over roomPrefix). */
  documentType?: string;
  roomPrefix?: string;
  userName: string;
  userColor: string;
  ydoc: Y.Doc;
  onBack?: () => void;
  onDocumentConverted?: (newDocId: string, newDocType: ConversionDocumentType) => void;
}

export interface UseCollabSessionResult {
  provider: WebsocketProvider | null;
  syncStatus: CollabSyncStatus;
  connectedUsers: CollabUser[];
  roomName: string;
}

function getCollaborationWsUrl(): string {
  const wsUrl: unknown = import.meta.env.VITE_WS_URL;
  if (typeof wsUrl === 'string' && wsUrl.length > 0) {
    return wsUrl.replace(/^http/, 'ws') + '/collaboration';
  }

  const configuredApiUrl: unknown = import.meta.env.VITE_API_URL;
  const apiUrl = typeof configuredApiUrl === 'string' ? configuredApiUrl : '';
  const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return apiUrl
    ? apiUrl.replace(/^http/, 'ws') + '/collaboration'
    : `${wsProtocol}//${window.location.host}/collaboration`;
}

/**
 * Owns IndexedDB persistence + WebSocket collaboration for one document.
 * Editor keeps TipTap/extensions; this hook owns transport only.
 */
export function useCollabSession({
  documentId,
  documentType,
  roomPrefix = 'doc',
  userName,
  userColor,
  ydoc,
  onBack,
  onDocumentConverted,
}: UseCollabSessionOptions): UseCollabSessionResult {
  const effectiveType = documentType ?? roomPrefix;
  const roomName = buildCollaborationRoomName(effectiveType, documentId);
  const cacheKey = `ship-${effectiveType}-${documentId}`;

  const [provider, setProvider] = useState<WebsocketProvider | null>(null);
  const [syncStatus, setSyncStatus] = useState<CollabSyncStatus>('connecting');
  const [connectedUsers, setConnectedUsers] = useState<CollabUser[]>([]);

  const onBackRef = useRef(onBack);
  const onDocumentConvertedRef = useRef(onDocumentConverted);
  onBackRef.current = onBack;
  onDocumentConvertedRef.current = onDocumentConverted;

  useEffect(() => {
    let wsProvider: WebsocketProvider | null = null;
    let hasCachedContent = false;
    let cancelled = false;
    let updateUsersCallback: (() => void) | null = null;
    let rawMessageHandler: ((event: MessageEvent) => void) | null = null;

    const indexeddbProvider = new IndexeddbPersistence(cacheKey, ydoc);

    const waitForCache = new Promise<void>((resolve) => {
      if (indexeddbProvider.synced) {
        hasCachedContent = true;
        setSyncStatus('cached');
        resolve();
        return;
      }

      const onSynced = () => {
        hasCachedContent = true;
        setSyncStatus((prev) => (prev === 'connecting' ? 'cached' : prev));
        resolve();
      };
      indexeddbProvider.on('synced', onSynced);

      setTimeout(() => {
        indexeddbProvider.off('synced', onSynced);
        resolve();
      }, 300);
    });

    waitForCache.then(() => {
      if (cancelled) return;

      const wsUrl = getCollaborationWsUrl();

      rawMessageHandler = (event: MessageEvent) => {
        if (cancelled) return;
        try {
          const data = new Uint8Array(event.data);
          if (data.length > 0 && data[0] === COLLAB_MESSAGE_CLEAR_CACHE) {
            ydoc.transact(() => {
              const fragment = ydoc.getXmlFragment('default');
              while (fragment.length > 0) {
                fragment.delete(0, 1);
              }
            });
            indexeddbProvider.clearData().then(() => {
              hasCachedContent = false;
            }).catch(() => {});
          }
        } catch {
          // non-binary messages ignored
        }
      };

	      wsProvider = new WebsocketProvider(wsUrl, roomName, ydoc, { connect: false });
	      const provider = wsProvider;

	      const attachRawMessageListener = () => {
	        if (provider.ws && rawMessageHandler) {
	          provider.ws.addEventListener('message', rawMessageHandler);
	        }
	      };

	      const originalConnect = provider.connect.bind(provider);
	      provider.connect = () => {
	        originalConnect();
	        attachRawMessageListener();
	      };

	      provider.on('status', (event: { status: string }) => {
        if (cancelled) return;
        if (event.status === 'connected') {
          attachRawMessageListener();
          setSyncStatus('synced');
        } else if (event.status === 'disconnected') {
          setSyncStatus(hasCachedContent ? 'cached' : 'disconnected');
        }
      });

	      provider.connect();

	      provider.on('connection-close', (event: CloseEvent | null) => {
	        if (cancelled) return;
	        if (event?.code === COLLAB_CLOSE_CODE_ACCESS_REVOKED) {
	          provider.shouldConnect = false;
	          alert('Access to this document has been revoked. The document is now private.');
	          onBackRef.current?.();
	        } else if (event?.code === COLLAB_CLOSE_CODE_CONVERSION) {
	          provider.shouldConnect = false;
          try {
            const conversionInfo = parseDocumentConversionInfo(event.reason || '');
            if (conversionInfo?.newDocId && conversionInfo.newDocType && onDocumentConvertedRef.current) {
              onDocumentConvertedRef.current(conversionInfo.newDocId, conversionInfo.newDocType);
            } else {
              alert('This document was converted. Please refresh to view the new document.');
              onBackRef.current?.();
            }
          } catch {
            alert('This document was converted. Please refresh to view the new document.');
            onBackRef.current?.();
          }
        } else if (event?.code === COLLAB_CLOSE_CODE_CONTENT_UPDATE) {
          indexeddbProvider.clearData().then(() => {
            hasCachedContent = false;
          }).catch(() => {});
        }
      });

	      provider.on('sync', (isSynced: boolean) => {
        if (cancelled) return;
        if (isSynced) {
          setSyncStatus('synced');
        }
      });

	      provider.awareness.setLocalStateField('user', {
        name: userName,
        color: userColor,
      });

      updateUsersCallback = () => {
	        if (cancelled) return;
	        const users: CollabUser[] = [];
	        const seenNames = new Set<string>();
	        provider.awareness.getStates().forEach((state: AwarenessState) => {
	          if (isCollabUser(state.user) && !seenNames.has(state.user.name)) {
            seenNames.add(state.user.name);
            users.push(state.user);
          }
        });
        setConnectedUsers(users);
      };

	      provider.awareness.on('change', updateUsersCallback);
	      updateUsersCallback();

	      if (!cancelled) {
	        setProvider(provider);
	      }
    });

    return () => {
      cancelled = true;
      if (wsProvider) {
        if (rawMessageHandler && wsProvider.ws) {
          wsProvider.ws.removeEventListener('message', rawMessageHandler);
        }
        wsProvider.awareness.setLocalState(null);
        if (updateUsersCallback) {
          wsProvider.awareness.off('change', updateUsersCallback);
        }
        wsProvider.destroy();
      }
      indexeddbProvider.destroy();
      setProvider(null);
      setConnectedUsers([]);
    };
  }, [documentId, documentType, roomPrefix, userName, userColor, ydoc, roomName, cacheKey]);

  return { provider, syncStatus, connectedUsers, roomName };
}
