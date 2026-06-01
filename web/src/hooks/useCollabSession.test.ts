/** Unit tests for collaborative session WebSocket lifecycle and cache-clear handling. */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import * as Y from 'yjs';
import {
  COLLAB_MESSAGE_CLEAR_CACHE,
  COLLAB_CLOSE_CODE_CONTENT_UPDATE,
  COLLAB_CLOSE_CODE_CONVERSION,
  COLLAB_CLOSE_CODE_ACCESS_REVOKED,
  buildCollaborationRoomName,
} from '@ship/shared';

const mockClearData = vi.fn().mockResolvedValue(undefined);
const mockIndexeddbDestroy = vi.fn();

vi.mock('y-indexeddb', () => ({
  IndexeddbPersistence: class MockIndexeddbPersistence {
    synced = true;
    on = vi.fn();
    off = vi.fn();
    clearData = mockClearData;
    destroy = mockIndexeddbDestroy;
  },
}));

type StatusHandler = (event: { status: string }) => void;
type CloseHandler = (event: CloseEvent | null) => void;

let _statusHandler: StatusHandler | null = null;
let closeHandler: CloseHandler | null = null;
let mockWs: { addEventListener: ReturnType<typeof vi.fn>; removeEventListener: ReturnType<typeof vi.fn> } | null =
  null;

const mockConnect = vi.fn();
const mockDestroy = vi.fn();

vi.mock('y-websocket', () => ({
  WebsocketProvider: class MockWebsocketProvider {
    ws: { addEventListener: ReturnType<typeof vi.fn>; removeEventListener: ReturnType<typeof vi.fn> };
    awareness = {
      setLocalStateField: vi.fn(),
      setLocalState: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
      getStates: vi.fn(() => new Map()),
    };
    connect = mockConnect;
    destroy = mockDestroy;
    shouldConnect = true;
    constructor() {
      mockWs = {
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      };
      this.ws = mockWs;
    }
    on(event: string, handler: StatusHandler | CloseHandler) {
      if (event === 'status') _statusHandler = handler as StatusHandler;
      if (event === 'connection-close') closeHandler = handler as CloseHandler;
    }
  },
}));

import { useCollabSession } from './useCollabSession';

const DOC_ID = '11111111-1111-4111-8111-111111111111';

describe('useCollabSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _statusHandler = null;
    closeHandler = null;
    mockWs = null;
  });

  it('builds canonical room names from document type', () => {
    expect(buildCollaborationRoomName('wiki', DOC_ID)).toBe(`wiki:${DOC_ID}`);
    expect(buildCollaborationRoomName('issue', DOC_ID)).toBe(`issue:${DOC_ID}`);
  });

  it('uses shared clear-cache and content-update close codes', () => {
    expect(COLLAB_MESSAGE_CLEAR_CACHE).toBe(3);
    expect(COLLAB_CLOSE_CODE_CONTENT_UPDATE).toBe(4101);
    expect(COLLAB_CLOSE_CODE_CONVERSION).toBe(4100);
    expect(COLLAB_CLOSE_CODE_ACCESS_REVOKED).toBe(4403);
  });

  it('returns roomName from documentType', async () => {
    const ydoc = new Y.Doc();
    const { result } = renderHook(() =>
      useCollabSession({
        documentId: DOC_ID,
        documentType: 'issue',
        userName: 'Test',
        userColor: '#ff0000',
        ydoc,
      })
    );

    await waitFor(() => {
      expect(result.current.roomName).toBe(`issue:${DOC_ID}`);
    });
  });

  it('clears IndexedDB when server sends content-update close code 4101', async () => {
    const ydoc = new Y.Doc();
    renderHook(() =>
      useCollabSession({
        documentId: DOC_ID,
        documentType: 'wiki',
        userName: 'Test',
        userColor: '#ff0000',
        ydoc,
      })
    );

    await waitFor(() => expect(closeHandler).not.toBeNull());

    act(() => {
      closeHandler?.({ code: COLLAB_CLOSE_CODE_CONTENT_UPDATE, reason: 'Content updated' } as CloseEvent);
    });

    await waitFor(() => {
      expect(mockClearData).toHaveBeenCalled();
    });
  });

  it('clears Y fragment and IndexedDB on clear-cache message type 3', async () => {
    const ydoc = new Y.Doc();
    const fragment = ydoc.getXmlFragment('default');
    fragment.insert(0, [new Y.XmlElement('paragraph')]);

    renderHook(() =>
      useCollabSession({
        documentId: DOC_ID,
        documentType: 'wiki',
        userName: 'Test',
        userColor: '#ff0000',
        ydoc,
      })
    );

    await waitFor(() => expect(mockWs).not.toBeNull());
    const ws = mockWs;
    if (!ws) {
      throw new Error('expected websocket mock after connection');
    }

    const messageHandler = ws.addEventListener.mock.calls.find(([event]) => event === 'message')?.[1] as
      | ((event: MessageEvent) => void)
      | undefined;

    expect(messageHandler).toBeDefined();

    act(() => {
      messageHandler?.({ data: new Uint8Array([COLLAB_MESSAGE_CLEAR_CACHE]).buffer } as MessageEvent);
    });

    await waitFor(() => {
      expect(fragment.length).toBe(0);
      expect(mockClearData).toHaveBeenCalled();
    });
  });

  it('does not reconnect when parent passes new onBack callback identity', async () => {
    const ydoc = new Y.Doc();
    const onBackA = vi.fn();
    const onBackB = vi.fn();

    const { rerender } = renderHook(
      ({ onBack }) =>
        useCollabSession({
          documentId: DOC_ID,
          documentType: 'wiki',
          userName: 'Test',
          userColor: '#ff0000',
          ydoc,
          onBack,
        }),
      { initialProps: { onBack: onBackA } }
    );

    await waitFor(() => expect(mockDestroy).toHaveBeenCalledTimes(0));

    const destroyCountBefore = mockDestroy.mock.calls.length;

    rerender({ onBack: onBackB });

    await waitFor(() => {
      expect(mockDestroy.mock.calls.length).toBe(destroyCountBefore);
    });
  });

  it('removes raw message listener on unmount', async () => {
    const ydoc = new Y.Doc();
    const { unmount } = renderHook(() =>
      useCollabSession({
        documentId: DOC_ID,
        documentType: 'wiki',
        userName: 'Test',
        userColor: '#ff0000',
        ydoc,
      })
    );

    await waitFor(() => expect(mockWs).not.toBeNull());
    const ws = mockWs;
    if (!ws) {
      throw new Error('expected websocket mock after connection');
    }
    expect(ws.addEventListener).toHaveBeenCalled();

    unmount();

    expect(ws.removeEventListener).toHaveBeenCalled();
    expect(mockDestroy).toHaveBeenCalled();
  });
});
