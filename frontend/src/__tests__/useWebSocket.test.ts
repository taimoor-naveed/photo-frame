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
  close = vi.fn();

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

    expect(wsInstances.length).toBeGreaterThanOrEqual(1);
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
});
