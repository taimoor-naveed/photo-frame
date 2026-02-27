import { renderHook, waitFor } from "@testing-library/react";
import { usePhotos } from "../hooks/usePhotos";
import type { MediaList } from "../api/client";

const mockList: MediaList = {
  items: [
    {
      id: 1,
      filename: "abc.jpg",
      original_name: "photo.jpg",
      media_type: "photo",
      width: 800,
      height: 600,
      file_size: 12345,
      duration: null,
      codec: null,
      thumb_filename: "thumb_abc.jpg",
      transcoded_filename: null,
      processing_status: "ready" as const,
      content_hash: "abc123",
      uploaded_at: "2026-01-01T00:00:00",
    },
  ],
  total: 1,
  page: 1,
  per_page: 50,
};

// Mock WebSocket globally (usePhotos now uses useWebSocket internally)
class MockWS {
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: (() => void) | null = null;
  readyState = 0;
  close = vi.fn();
  constructor() {
    setTimeout(() => this.onopen?.(), 0);
  }
}

const OriginalWebSocket = globalThis.WebSocket;

beforeAll(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.WebSocket = MockWS as any;
});

afterAll(() => {
  globalThis.WebSocket = OriginalWebSocket;
});

beforeEach(() => {
  vi.restoreAllMocks();
});

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
    expect(result.current.photos[0].original_name).toBe("photo.jpg");
    expect(result.current.total).toBe(1);
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
});
