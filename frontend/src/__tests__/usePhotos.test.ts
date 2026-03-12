import { renderHook, waitFor, act } from "@testing-library/react";
import { usePhotos } from "../hooks/usePhotos";
import type { Media, MediaList } from "../api/client";

function makeMedia(id: number): Media {
  return {
    id,
    filename: `photo${id}.jpg`,
    original_name: `photo${id}.jpg`,
    media_type: "photo",
    width: 800,
    height: 600,
    file_size: 12345,
    duration: null,
    codec: null,
    thumb_filename: `thumb_photo${id}.jpg`,
    transcoded_filename: null,
    display_filename: null,
    processing_status: "ready" as const,
    content_hash: `hash${id}`,
    uploaded_at: `2026-01-01T00:00:00`,
  };
}

function makePage(items: Media[], total: number, page: number): MediaList {
  return { items, total, page, per_page: 50 };
}

const mockList: MediaList = makePage([makeMedia(1)], 1, 1);

// Mock WebSocket that tracks instances for sending messages
let wsInstances: MockWS[] = [];

class MockWS {
  static readonly OPEN = 1;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  readyState = 0;
  close = vi.fn();
  constructor() {
    wsInstances.push(this);
    setTimeout(() => {
      this.readyState = 1;
      this.onopen?.();
    }, 0);
  }

  simulateMessage(data: object) {
    this.onmessage?.({ data: JSON.stringify(data) });
  }
}

const OriginalWebSocket = globalThis.WebSocket;

beforeEach(() => {
  wsInstances = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.stubGlobal("WebSocket", MockWS as any);
  vi.restoreAllMocks();
  // Re-stub after restoreAllMocks since it clears stubs
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.stubGlobal("WebSocket", MockWS as any);
});

afterAll(() => {
  globalThis.WebSocket = OriginalWebSocket;
});

function getLatestWs(): MockWS {
  const ws = wsInstances[wsInstances.length - 1];
  if (!ws) throw new Error("No WebSocket instance found");
  return ws;
}

describe("usePhotos", () => {
  it("fetches photos on mount", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => mockList,
    } as Response);

    const { result } = renderHook(() => usePhotos());

    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.photos).toHaveLength(1);
    expect(result.current.photos[0].original_name).toBe("photo1.jpg");
    expect(result.current.total).toBe(1);
  });

  it("fetches page 1 with per_page=50", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => mockList,
    } as Response);

    renderHook(() => usePhotos());

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    const url = fetchSpy.mock.calls[0][0] as string;
    expect(url).toContain("page=1");
    expect(url).toContain("per_page=50");
  });

  it("handles fetch error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => "Server error",
    } as Response);

    const { result } = renderHook(() => usePhotos());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeTruthy();
    expect(result.current.photos).toHaveLength(0);
  });

  it("deletes a photo and refetches", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      // Initial fetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => mockList,
      } as Response)
      // Delete call
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true }),
      } as Response)
      // Refetch after delete
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ...mockList, items: [], total: 0 }),
      } as Response);

    const { result } = renderHook(() => usePhotos());

    await waitFor(() => expect(result.current.loading).toBe(false));
    await result.current.deletePhoto(1);
    await waitFor(() => expect(result.current.total).toBe(0));
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  // ─── Infinite Scroll Tests ──────────────────────────────────

  it("sets hasMore=true when total exceeds first page", async () => {
    const page1Items = Array.from({ length: 50 }, (_, i) => makeMedia(i + 1));
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => makePage(page1Items, 75, 1),
    } as Response);

    const { result } = renderHook(() => usePhotos());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.hasMore).toBe(true);
    expect(result.current.photos).toHaveLength(50);
  });

  it("sets hasMore=false when all items fit in one page", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => makePage([makeMedia(1), makeMedia(2)], 2, 1),
    } as Response);

    const { result } = renderHook(() => usePhotos());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.hasMore).toBe(false);
  });

  it("fetchNextPage appends items and increments page", async () => {
    const page1Items = Array.from({ length: 50 }, (_, i) => makeMedia(i + 1));
    const page2Items = Array.from({ length: 25 }, (_, i) => makeMedia(i + 51));

    const fetchSpy = vi.spyOn(globalThis, "fetch")
      // Initial fetch (page 1)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => makePage(page1Items, 75, 1),
      } as Response)
      // Page 2
      .mockResolvedValueOnce({
        ok: true,
        json: async () => makePage(page2Items, 75, 2),
      } as Response);

    const { result } = renderHook(() => usePhotos());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.photos).toHaveLength(50);
    expect(result.current.hasMore).toBe(true);

    await act(async () => {
      await result.current.fetchNextPage();
    });

    expect(result.current.photos).toHaveLength(75);
    expect(result.current.hasMore).toBe(false);
    // Verify page 2 was requested
    const page2Url = fetchSpy.mock.calls[1][0] as string;
    expect(page2Url).toContain("page=2");
  });

  it("prevents concurrent fetchNextPage calls", async () => {
    const page1Items = Array.from({ length: 50 }, (_, i) => makeMedia(i + 1));

    // Page 2 resolves slowly
    let resolvePage2: ((v: Response) => void) | undefined;
    const page2Promise = new Promise<Response>((r) => { resolvePage2 = r; });

    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({
        ok: true,
        json: async () => makePage(page1Items, 120, 1),
      } as Response)
      .mockReturnValueOnce(page2Promise);

    const { result } = renderHook(() => usePhotos());
    await waitFor(() => expect(result.current.loading).toBe(false));

    // Start first fetchNextPage (doesn't resolve yet)
    act(() => { result.current.fetchNextPage(); });

    // Try second call immediately — should be blocked
    act(() => { result.current.fetchNextPage(); });

    // Resolve page 2
    await act(async () => {
      resolvePage2!({
        ok: true,
        json: async () => makePage(Array.from({ length: 50 }, (_, i) => makeMedia(i + 51)), 120, 2),
      } as Response);
    });

    // Only 2 fetch calls total: initial + one page 2 (not two)
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("WS media_added resets to page 1 and replaces photos", async () => {
    const page1Items = Array.from({ length: 50 }, (_, i) => makeMedia(i + 1));
    const newPage1 = [makeMedia(99), ...page1Items.slice(0, 49)];

    const fetchSpy = vi.spyOn(globalThis, "fetch")
      // Initial fetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => makePage(page1Items, 75, 1),
      } as Response)
      // Refetch after WS event (page 1 with new item at top)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => makePage(newPage1, 76, 1),
      } as Response);

    const { result } = renderHook(() => usePhotos());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.photos[0].id).toBe(1);

    // Flush WS creation
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });

    // Simulate WS media_added event
    const ws = getLatestWs();
    await act(async () => {
      ws.simulateMessage({
        type: "media_added",
        payload: makeMedia(99),
      });
    });

    // Wait for refetch to complete
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2));

    // Verify the refetch was to page 1
    const refetchUrl = fetchSpy.mock.calls[1][0] as string;
    expect(refetchUrl).toContain("page=1");

    // Verify photos were replaced (not appended) — first item is now 99
    await waitFor(() => expect(result.current.photos[0].id).toBe(99));
    expect(result.current.photos).toHaveLength(50);
  });

  it("discards stale fetchNextPage response after reset", async () => {
    const page1Items = Array.from({ length: 50 }, (_, i) => makeMedia(i + 1));
    const staleItems = Array.from({ length: 25 }, (_, i) => makeMedia(i + 51));
    const freshPage1 = [makeMedia(99), ...page1Items.slice(0, 49)];

    // Page 2 resolves slowly — we'll trigger a reset before it completes
    let resolvePage2: ((v: Response) => void) | undefined;
    const page2Promise = new Promise<Response>((r) => { resolvePage2 = r; });

    vi.spyOn(globalThis, "fetch")
      // Initial fetch (page 1)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => makePage(page1Items, 75, 1),
      } as Response)
      // Page 2 (slow)
      .mockReturnValueOnce(page2Promise)
      // Reset fetch (page 1 again, triggered by WS)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => makePage(freshPage1, 76, 1),
      } as Response);

    const { result } = renderHook(() => usePhotos());
    await waitFor(() => expect(result.current.loading).toBe(false));

    // Start fetchNextPage (page 2 — slow, in flight)
    act(() => { result.current.fetchNextPage(); });

    // Flush WS creation
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });

    // WS event triggers reset to page 1 while page 2 is still in flight
    const ws = getLatestWs();
    await act(async () => {
      ws.simulateMessage({
        type: "media_added",
        payload: makeMedia(99),
      });
    });

    // Wait for reset to complete
    await waitFor(() => expect(result.current.photos[0].id).toBe(99));

    // Now resolve the stale page 2
    await act(async () => {
      resolvePage2!({
        ok: true,
        json: async () => makePage(staleItems, 75, 2),
      } as Response);
    });

    // Stale page 2 data should NOT have been appended
    // Photos should still be the fresh page 1 (50 items starting with 99)
    expect(result.current.photos).toHaveLength(50);
    expect(result.current.photos[0].id).toBe(99);
    // None of the stale items (51-75) should be present
    const ids = result.current.photos.map((p) => p.id);
    expect(ids).not.toContain(51);
  });

  it("reset clears loadingMore when fetchNextPage is in flight", async () => {
    const page1Items = Array.from({ length: 50 }, (_, i) => makeMedia(i + 1));

    // Page 2 resolves slowly
    let resolvePage2: ((v: Response) => void) | undefined;
    const page2Promise = new Promise<Response>((r) => { resolvePage2 = r; });

    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({
        ok: true,
        json: async () => makePage(page1Items, 75, 1),
      } as Response)
      .mockReturnValueOnce(page2Promise)
      // Reset fetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => makePage(page1Items, 75, 1),
      } as Response);

    const { result } = renderHook(() => usePhotos());
    await waitFor(() => expect(result.current.loading).toBe(false));

    // Start fetchNextPage (in flight)
    act(() => { result.current.fetchNextPage(); });
    expect(result.current.loadingMore).toBe(true);

    // Flush WS creation
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });

    // Reset via WS event
    const ws = getLatestWs();
    await act(async () => {
      ws.simulateMessage({ type: "media_deleted", payload: { id: 1 } });
    });

    // loadingMore should be cleared immediately by the reset
    expect(result.current.loadingMore).toBe(false);

    // Resolve stale page 2 — should not re-set loadingMore
    await act(async () => {
      resolvePage2!({
        ok: true,
        json: async () => makePage([], 75, 2),
      } as Response);
    });
    expect(result.current.loadingMore).toBe(false);
  });
});
