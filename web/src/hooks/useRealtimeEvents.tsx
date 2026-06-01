import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useCallback,
  useState,
  type ReactNode,
} from 'react';
import type { RealtimeEvent, RealtimeEventType } from '@ship/shared';
import { useAuth } from './useAuth';

export type { RealtimeEvent, RealtimeEventType };

type EventCallback = (event: RealtimeEvent) => void;

interface RealtimeEventsContextType {
  isConnected: boolean;
  subscribe: (eventType: RealtimeEventType, callback: EventCallback) => () => void;
}

const RealtimeEventsContext = createContext<RealtimeEventsContextType | null>(null);

// WebSocket URLs for different environments
// VITE_WS_URL allows bypassing CloudFront (which doesn't support WebSocket)
// by connecting directly to the EB endpoint for real-time events
function getEventsWsUrl(): string {
  const wsUrl: unknown = import.meta.env.VITE_WS_URL;
  if (typeof wsUrl === 'string' && wsUrl.length > 0) {
    return wsUrl.replace(/^http/, 'ws') + '/events';
  }

  const apiUrl: unknown = import.meta.env.VITE_API_URL;
  const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  if (typeof apiUrl === 'string' && apiUrl.length > 0) {
    return apiUrl.replace(/^http/, 'ws') + '/events';
  }
  return `${wsProtocol}//${window.location.host}/events`;
}

export function RealtimeEventsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const wsRef = useRef<WebSocket | null>(null);
  const userRef = useRef(user);
  const intentionalDisconnectRef = useRef(false);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const subscribersRef = useRef<Map<RealtimeEventType, Set<EventCallback>>>(new Map());
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    userRef.current = user;
  }, [user]);

  // Subscribe to events
  const subscribe = useCallback((eventType: RealtimeEventType, callback: EventCallback) => {
    if (!subscribersRef.current.has(eventType)) {
      subscribersRef.current.set(eventType, new Set());
    }
    const subscribers = subscribersRef.current.get(eventType);
    if (!subscribers) return () => {};
    subscribers.add(callback);

    // Return unsubscribe function
    return () => {
      subscribersRef.current.get(eventType)?.delete(callback);
    };
  }, []);

  // Connect to WebSocket
  const connect = useCallback(() => {
    if (!userRef.current) return;
    if (wsRef.current?.readyState === WebSocket.OPEN) return;
    if (wsRef.current?.readyState === WebSocket.CONNECTING) return;
    if (wsRef.current?.readyState === WebSocket.CLOSING) return;

    intentionalDisconnectRef.current = false;
    const ws = new WebSocket(getEventsWsUrl());
    wsRef.current = ws;

    ws.onopen = () => {
      console.log('[RealtimeEvents] Connected');
      setIsConnected(true);
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(String(event.data)) as RealtimeEvent;
        console.log('[RealtimeEvents] Received:', data.type);

        // Notify subscribers
        const callbacks = subscribersRef.current.get(data.type);
        if (callbacks) {
          callbacks.forEach((callback) => callback(data));
        }
      } catch (err) {
        console.error('[RealtimeEvents] Failed to parse message:', err);
      }
    };

    ws.onclose = () => {
      console.log('[RealtimeEvents] Disconnected');
      setIsConnected(false);
      // Only nullify if this is still the current WebSocket
      // (avoids race where a new WS was created before old one finished closing)
      if (wsRef.current === ws) {
        wsRef.current = null;
      }

      // Reconnect after delay if user is still logged in.
      if (!intentionalDisconnectRef.current && userRef.current) {
        reconnectTimeoutRef.current = setTimeout(() => {
          if (!userRef.current) return;
          console.log('[RealtimeEvents] Reconnecting...');
          connect();
        }, 3000);
      }
    };

    ws.onerror = (err) => {
      console.error('[RealtimeEvents] Error:', err);
      ws.close();
    };
  }, []);

  // Disconnect from WebSocket
  const disconnect = useCallback(() => {
    intentionalDisconnectRef.current = true;
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setIsConnected(false);
  }, []);

  // Connect when user logs in, disconnect when they log out
  useEffect(() => {
    if (user) {
      connect();
    } else {
      disconnect();
    }

    return () => {
      disconnect();
    };
  }, [user, connect, disconnect]);

  // Keepalive ping every 30 seconds
  useEffect(() => {
    if (!isConnected) return;

    const pingInterval = setInterval(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'ping' }));
      }
    }, 30000);

    return () => clearInterval(pingInterval);
  }, [isConnected]);

  return (
    <RealtimeEventsContext.Provider value={{ isConnected, subscribe }}>
      {children}
    </RealtimeEventsContext.Provider>
  );
}

export function useRealtimeEvents() {
  const context = useContext(RealtimeEventsContext);
  if (!context) {
    throw new Error('useRealtimeEvents must be used within RealtimeEventsProvider');
  }
  return context;
}

/**
 * Hook to listen for a specific realtime event type.
 * Automatically subscribes on mount and unsubscribes on unmount.
 */
export function useRealtimeEvent(eventType: RealtimeEventType, callback: EventCallback) {
  const { subscribe } = useRealtimeEvents();

  useEffect(() => {
    return subscribe(eventType, callback);
  }, [eventType, callback, subscribe]);
}
