import { useCallback, useEffect, useRef, useState } from "react";

export interface WsEvent {
  type:
    | "media_added"
    | "media_deleted"
    | "media_processing_complete"
    | "media_processing_error"
    | "media_processing_progress"
    | "settings_changed";
  payload: Record<string, unknown>;
}

interface UseWebSocketOptions {
  onEvent?: (event: WsEvent) => void;
}

export function useWebSocket(options: UseWebSocketOptions = {}) {
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const onEventRef = useRef(options.onEvent);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Keep callback ref fresh without re-triggering effect
  onEventRef.current = options.onEvent;

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);

    ws.onopen = () => {
      setConnected(true);
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as WsEvent;
        onEventRef.current?.(data);
      } catch {
        // Ignore non-JSON messages
      }
    };

    ws.onclose = () => {
      setConnected(false);
      wsRef.current = null;
      // Auto-reconnect after 2 seconds
      reconnectTimer.current = setTimeout(connect, 2000);
    };

    ws.onerror = () => {
      ws.close();
    };

    wsRef.current = ws;
  }, []);

  useEffect(() => {
    connect();
    return () => {
      clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [connect]);

  return { connected };
}
