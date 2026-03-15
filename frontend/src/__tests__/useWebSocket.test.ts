import { renderHook, act } from "@testing-library/react";
import { useWebSocket, type WsEvent } from "../hooks/useWebSocket";

// Track instances for test assertions
let wsInstances: MockWS[] = [];

class MockWS {
  static readonly OPEN = 1;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readyState = 0;
  close = vi.fn(() => {
    this.readyState = 3;
    this.onclose?.();
  });

  constructor(_url: string) {
    wsInstances.push(this);
  }

  simulateOpen() {
    this.readyState = 1;
    this.onopen?.();
  }

  simulateMessage(data: WsEvent) {
    this.onmessage?.({ data: JSON.stringify(data) });
  }

  simulateClose() {
    this.readyState = 3;
    this.onclose?.();
  }
}

beforeEach(() => {
  wsInstances = [];
  vi.useFakeTimers();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.stubGlobal("WebSocket", MockWS as any);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("useWebSocket", () => {
  it("connects on mount and sets connected state", async () => {
    await act(async () => {
      renderHook(() => useWebSocket());
    });

    expect(wsInstances).toHaveLength(1);
    expect(wsInstances[0]).toBeDefined();

    act(() => {
      wsInstances[0].simulateOpen();
    });

    expect(wsInstances).toHaveLength(1);
  });

  it("calls onEvent when message received", async () => {
    const onEvent = vi.fn();

    await act(async () => {
      renderHook(() => useWebSocket({ onEvent }));
    });

    expect(wsInstances).toHaveLength(1);

    act(() => {
      wsInstances[0].simulateOpen();
    });

    const event: WsEvent = {
      type: "media_added",
      payload: { id: 1 },
    };

    act(() => {
      wsInstances[0].simulateMessage(event);
    });

    expect(onEvent).toHaveBeenCalledWith(event);
  });

  it("auto-reconnects after disconnect", async () => {
    await act(async () => {
      renderHook(() => useWebSocket());
    });

    act(() => {
      wsInstances[0].simulateOpen();
    });

    act(() => {
      wsInstances[0].simulateClose();
    });

    expect(wsInstances).toHaveLength(1);

    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(wsInstances).toHaveLength(2);
  });

  it("cleans up on unmount", async () => {
    let unmountFn: () => void;
    await act(async () => {
      const { unmount } = renderHook(() => useWebSocket());
      unmountFn = unmount;
    });

    act(() => {
      wsInstances[0].simulateOpen();
    });

    unmountFn!();

    expect(wsInstances[0].close).toHaveBeenCalled();
  });

  it("does not reconnect after unmount", async () => {
    let unmountFn: () => void;
    await act(async () => {
      const { unmount } = renderHook(() => useWebSocket());
      unmountFn = unmount;
    });

    act(() => {
      wsInstances[0].simulateOpen();
    });

    const instanceCountBeforeUnmount = wsInstances.length;

    act(() => {
      unmountFn!();
    });

    act(() => {
      vi.advanceTimersByTime(5000);
    });

    expect(wsInstances).toHaveLength(instanceCountBeforeUnmount);
  });

  it("does not reconnect when close fires after cleanup", async () => {
    let unmountFn: () => void;
    await act(async () => {
      const { unmount } = renderHook(() => useWebSocket());
      unmountFn = unmount;
    });

    const ws = wsInstances[0];

    act(() => {
      ws.simulateOpen();
    });

    // Unmount without the mock auto-firing onclose — simulate delayed delivery
    // Override close to NOT auto-fire onclose for this test
    ws.close = vi.fn();

    act(() => {
      unmountFn!();
    });

    const instanceCountAfterUnmount = wsInstances.length;

    // Now onclose fires after cleanup has finished
    act(() => {
      ws.simulateClose();
    });

    act(() => {
      vi.advanceTimersByTime(5000);
    });

    expect(wsInstances).toHaveLength(instanceCountAfterUnmount);
  });

  it("reconnects after unexpected disconnect (not unmount)", async () => {
    await act(async () => {
      renderHook(() => useWebSocket());
    });

    act(() => {
      wsInstances[0].simulateOpen();
    });

    act(() => {
      wsInstances[0].simulateClose();
    });

    expect(wsInstances).toHaveLength(1);

    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(wsInstances).toHaveLength(2);
  });

  it("reconnects on disconnect after StrictMode remount", async () => {
    // Mount
    let unmountFn: () => void;
    await act(async () => {
      const { unmount } = renderHook(() => useWebSocket());
      unmountFn = unmount;
    });

    // Unmount (StrictMode cleanup) — sets isShuttingDown = true
    act(() => {
      unmountFn!();
    });

    // Remount (StrictMode re-run) — should reset isShuttingDown = false
    await act(async () => {
      renderHook(() => useWebSocket());
    });

    const remountedWs = wsInstances[wsInstances.length - 1];

    act(() => {
      remountedWs.simulateOpen();
    });

    // Unexpected disconnect on the remounted instance
    act(() => {
      remountedWs.simulateClose();
    });

    const instancesBeforeReconnect = wsInstances.length;

    act(() => {
      vi.advanceTimersByTime(2000);
    });

    // Should reconnect because isShuttingDown was reset
    expect(wsInstances).toHaveLength(instancesBeforeReconnect + 1);
  });

  it("does not stack reconnect timers on rapid disconnects", async () => {
    await act(async () => {
      renderHook(() => useWebSocket());
    });

    act(() => {
      wsInstances[0].simulateOpen();
    });

    // Two rapid disconnects
    act(() => {
      wsInstances[0].simulateClose();
    });

    act(() => {
      wsInstances[0].simulateClose();
    });

    const instancesBeforeTimer = wsInstances.length;

    act(() => {
      vi.advanceTimersByTime(5000);
    });

    // Only one new instance, not two
    expect(wsInstances).toHaveLength(instancesBeforeTimer + 1);
  });
});
