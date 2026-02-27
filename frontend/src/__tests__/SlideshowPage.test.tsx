import { render, screen, waitFor, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import SlideshowPage from "../pages/SlideshowPage";
import type { Media, MediaList, Settings } from "../api/client";

const mockSettings: Settings = {
  slideshow_interval: 10,
  transition_type: "crossfade",
};

function makePhoto(id: number, name?: string): Media {
  return {
    id,
    filename: `photo${id}.jpg`,
    original_name: name ?? `photo${id}.jpg`,
    media_type: "photo",
    width: 800,
    height: 600,
    file_size: 12345,
    duration: null,
    codec: null,
    thumb_filename: `thumb_photo${id}.jpg`,
    transcoded_filename: null,
    processing_status: "ready" as const,
    content_hash: `hash${id}`,
    uploaded_at: `2026-01-0${id}T00:00:00`,
  };
}

function makeVideo(
  id: number,
  status: "ready" | "processing" = "ready",
): Media {
  return {
    id,
    filename: `video${id}.mp4`,
    original_name: `video${id}.mp4`,
    media_type: "video",
    width: 1920,
    height: 1080,
    file_size: 99999,
    duration: 3.5,
    codec: "h264",
    thumb_filename: `thumb_video${id}.jpg`,
    transcoded_filename: null,
    processing_status: status,
    content_hash: `vhash${id}`,
    uploaded_at: `2026-01-0${id}T00:00:00`,
  };
}

const mockMedia: MediaList = {
  items: [makePhoto(1, "sunset.jpg"), makeVideo(2)],
  total: 2,
  page: 1,
  per_page: 1000,
};

// Mock WebSocket that captures instances for sending messages
let wsInstances: MockWS[] = [];

class MockWS {
  static readonly OPEN = 1;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  readyState = 0;
  close = vi.fn();
  constructor(_url: string) {
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

beforeEach(() => {
  wsInstances = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.stubGlobal("WebSocket", MockWS as any);
  vi.restoreAllMocks();
  // Re-stub after restoreAllMocks since it clears stubs
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.stubGlobal("WebSocket", MockWS as any);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function mockFetch(items: Media[], settings: Settings = mockSettings) {
  vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
    const url = typeof input === "string" ? input : (input as Request).url;
    if (url.includes("/media")) {
      return Promise.resolve({
        ok: true,
        json: async () => ({
          items,
          total: items.length,
          page: 1,
          per_page: 1000,
        }),
      } as Response);
    }
    return Promise.resolve({
      ok: true,
      json: async () => settings,
    } as Response);
  });
}

/** Wait for the slideshow to fully render and WS to be created. */
async function waitForSlideshow() {
  await waitFor(() => {
    // Look for any media element — non-hidden img or video
    const imgs = document.querySelectorAll("img:not([aria-hidden])");
    const videos = document.querySelectorAll("video");
    expect(imgs.length + videos.length).toBeGreaterThan(0);
  });
  // Flush remaining effects (including WS creation)
  await act(async () => {
    await new Promise((r) => setTimeout(r, 10));
  });
}

function getLatestWs(): MockWS {
  const ws = wsInstances[wsInstances.length - 1];
  if (!ws)
    throw new Error(
      "No WebSocket instance found — did you call waitForSlideshow() first?",
    );
  return ws;
}

/** Get the data-media-id of the currently displayed foreground element (z-10 layer). */
function getCurrentMediaId(): number | null {
  // Scope to the z-10 current slide layer to avoid matching the z-0 prev slide during transitions
  const el = document.querySelector(".z-10 [data-media-id]");
  return el ? Number(el.getAttribute("data-media-id")) : null;
}

/** Navigate forward `count` times via ArrowRight, collecting all media IDs seen. */
async function collectAllMediaIds(count: number): Promise<Set<number>> {
  const ids = new Set<number>();
  const first = getCurrentMediaId();
  if (first !== null) ids.add(first);
  for (let i = 0; i < count; i++) {
    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowRight" }),
      );
    });
    const id = getCurrentMediaId();
    if (id !== null) ids.add(id);
  }
  return ids;
}

describe("SlideshowPage", () => {
  it("shows loading spinner initially", () => {
    vi.spyOn(globalThis, "fetch").mockReturnValue(new Promise(() => {}));

    const { container } = render(
      <MemoryRouter>
        <SlideshowPage />
      </MemoryRouter>,
    );

    expect(container.querySelector(".animate-spin")).toBeTruthy();
  });

  it("shows empty state when no media", async () => {
    mockFetch([]);

    render(
      <MemoryRouter>
        <SlideshowPage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText("No photos to display")).toBeInTheDocument();
    });
    expect(
      screen.getByText("Upload photos to start slideshow"),
    ).toBeInTheDocument();
  });

  it("shows first photo immediately when added to empty slideshow via WS", async () => {
    mockFetch([]);

    render(
      <MemoryRouter>
        <SlideshowPage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText("No photos to display")).toBeInTheDocument();
    });

    // Wait for WS to be created
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });

    const ws = getLatestWs();
    await act(async () => {
      ws.simulateMessage({
        type: "media_added",
        payload: makePhoto(10),
      });
    });

    // Photo should display immediately with the correct ID and src
    await waitFor(() => {
      expect(getCurrentMediaId()).toBe(10);
    });
    const fg = document.querySelector("[data-media-id]") as HTMLImageElement;
    expect(fg.src).toContain("/uploads/originals/photo10.jpg");
  });

  it("renders media when media exists", async () => {
    mockFetch(mockMedia.items);

    render(
      <MemoryRouter>
        <SlideshowPage />
      </MemoryRouter>,
    );

    // With random order, either photo (1) or video (2) could be first
    await waitForSlideshow();
    expect([1, 2]).toContain(getCurrentMediaId());
  });

  it("shows pause indicator when space pressed", async () => {
    mockFetch(mockMedia.items);

    render(
      <MemoryRouter>
        <SlideshowPage />
      </MemoryRouter>,
    );

    await waitForSlideshow();

    window.dispatchEvent(new KeyboardEvent("keydown", { key: " " }));

    await waitFor(() => {
      expect(screen.getByText("Paused")).toBeInTheDocument();
    });
  });

  // ─── Shuffle & Initial Build ─────────────────────────────

  it("shuffles media into random order on load", async () => {
    const items = [
      makePhoto(1),
      makePhoto(2),
      makePhoto(3),
      makePhoto(4),
      makePhoto(5),
    ];
    mockFetch(items);

    render(
      <MemoryRouter>
        <SlideshowPage />
      </MemoryRouter>,
    );

    await waitForSlideshow();
    // Current media should be one of the 5 photos
    expect([1, 2, 3, 4, 5]).toContain(getCurrentMediaId());
    // All 5 should be reachable via navigation
    const ids = await collectAllMediaIds(5);
    expect(ids.size).toBe(5);
  });

  it("excludes processing videos from initial playlist", async () => {
    const items = [
      makePhoto(1),
      makePhoto(2),
      makePhoto(3),
      makeVideo(4, "processing"),
    ];
    mockFetch(items);

    render(
      <MemoryRouter>
        <SlideshowPage />
      </MemoryRouter>,
    );

    await waitForSlideshow();

    // Processing video should not appear — no <video> element
    expect(document.querySelectorAll("video").length).toBe(0);
  });

  // ─── WebSocket: Media Added ───────────────────────────────

  it("does not add processing video to playlist via WS", async () => {
    mockFetch([makePhoto(1)]);

    render(
      <MemoryRouter>
        <SlideshowPage />
      </MemoryRouter>,
    );

    await waitForSlideshow();

    const ws = getLatestWs();
    await act(async () => {
      ws.simulateMessage({
        type: "media_added",
        payload: makeVideo(10, "processing"),
      });
    });

    // No video element should appear
    expect(document.querySelectorAll("video").length).toBe(0);
  });

  it("adds new photo via WS media_added", async () => {
    mockFetch([makePhoto(1)]);

    render(
      <MemoryRouter>
        <SlideshowPage />
      </MemoryRouter>,
    );

    await waitForSlideshow();
    // Only photo 1 exists, so it must be current
    expect(getCurrentMediaId()).toBe(1);

    const ws = getLatestWs();
    await act(async () => {
      ws.simulateMessage({
        type: "media_added",
        payload: makePhoto(10),
      });
    });

    // Current should still be photo 1
    expect(getCurrentMediaId()).toBe(1);

    // Both photos should be reachable via navigation
    const ids = await collectAllMediaIds(2);
    expect(ids).toEqual(new Set([1, 10]));
  });

  it("dedup: ignores duplicate media_added for same ID", async () => {
    mockFetch([makePhoto(1), makePhoto(2)]);

    render(
      <MemoryRouter>
        <SlideshowPage />
      </MemoryRouter>,
    );

    await waitForSlideshow();

    const ws = getLatestWs();
    const newPhoto = makePhoto(10);

    // Send same media_added twice
    await act(async () => {
      ws.simulateMessage({ type: "media_added", payload: newPhoto });
    });
    await act(async () => {
      ws.simulateMessage({ type: "media_added", payload: newPhoto });
    });

    // Navigate through all items — should be exactly 3 unique IDs (no duplicate)
    const ids = await collectAllMediaIds(3);
    expect(ids).toEqual(new Set([1, 2, 10]));
  });

  // ─── WebSocket: Media Deleted ─────────────────────────────

  it("removes deleted media from playlist via WS", async () => {
    mockFetch([makePhoto(1), makePhoto(2), makePhoto(3)]);

    render(
      <MemoryRouter>
        <SlideshowPage />
      </MemoryRouter>,
    );

    await waitForSlideshow();

    const ws = getLatestWs();
    await act(async () => {
      ws.simulateMessage({ type: "media_deleted", payload: { id: 2 } });
    });

    // Current should be one of the remaining items
    expect([1, 3]).toContain(getCurrentMediaId());

    // Navigate through all — ID 2 should be gone, exactly 2 items remain
    const ids = await collectAllMediaIds(2);
    expect(ids).toEqual(new Set([1, 3]));
  });

  it("shows empty state when all media deleted via WS", async () => {
    mockFetch([makePhoto(1)]);

    render(
      <MemoryRouter>
        <SlideshowPage />
      </MemoryRouter>,
    );

    await waitForSlideshow();

    const ws = getLatestWs();
    await act(async () => {
      ws.simulateMessage({ type: "media_deleted", payload: { id: 1 } });
    });

    await waitFor(() => {
      expect(screen.getByText("No photos to display")).toBeInTheDocument();
    });
  });

  it("handles deletion of media not in playlist", async () => {
    mockFetch([makePhoto(1), makePhoto(2)]);

    render(
      <MemoryRouter>
        <SlideshowPage />
      </MemoryRouter>,
    );

    await waitForSlideshow();

    const ws = getLatestWs();
    // Delete an ID that doesn't exist in playlist
    await act(async () => {
      ws.simulateMessage({ type: "media_deleted", payload: { id: 999 } });
    });

    // Playlist should be unchanged — both items still reachable
    const ids = await collectAllMediaIds(2);
    expect(ids).toEqual(new Set([1, 2]));
  });

  // ─── WebSocket: Video Processing Complete ─────────────────

  it("adds completed video to playlist via media_processing_complete", async () => {
    const processingVideo = makeVideo(10, "processing");
    mockFetch([makePhoto(1), processingVideo]);

    render(
      <MemoryRouter>
        <SlideshowPage />
      </MemoryRouter>,
    );

    await waitForSlideshow();

    const ws = getLatestWs();
    const readyVideo = {
      ...processingVideo,
      processing_status: "ready" as const,
    };

    await act(async () => {
      ws.simulateMessage({
        type: "media_processing_complete",
        payload: readyVideo,
      });
    });

    // Both IDs should be reachable
    const ids = await collectAllMediaIds(2);
    expect(ids).toEqual(new Set([1, 10]));
  });

  it("updates in-place if video already in playlist on media_processing_complete", async () => {
    const readyVideo = makeVideo(2);
    mockFetch([makePhoto(1), readyVideo]);

    render(
      <MemoryRouter>
        <SlideshowPage />
      </MemoryRouter>,
    );

    await waitForSlideshow();

    const ws = getLatestWs();
    const updatedVideo = { ...readyVideo, codec: "vp9" };

    await act(async () => {
      ws.simulateMessage({
        type: "media_processing_complete",
        payload: updatedVideo,
      });
    });

    // Should still have exactly 2 items (no duplication), IDs {1, 2}
    const ids = await collectAllMediaIds(2);
    expect(ids).toEqual(new Set([1, 2]));
  });

  // ─── Targeted Bug-Class Tests ────────────────────────────

  it("empty to first photo via WS: displays immediately with correct ID", async () => {
    mockFetch([]);

    render(
      <MemoryRouter>
        <SlideshowPage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText("No photos to display")).toBeInTheDocument();
    });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });

    const ws = getLatestWs();
    await act(async () => {
      ws.simulateMessage({
        type: "media_added",
        payload: makePhoto(42),
      });
    });

    // Must show photo 42 immediately — not black screen, not wrong index
    await waitFor(() => {
      expect(getCurrentMediaId()).toBe(42);
    });
    const fg = document.querySelector("[data-media-id]") as HTMLImageElement;
    expect(fg.src).toContain("/uploads/originals/photo42.jpg");
  });

  it("adding photo via WS preserves the currently displayed media", async () => {
    mockFetch([makePhoto(1), makePhoto(2), makePhoto(3)]);

    render(
      <MemoryRouter>
        <SlideshowPage />
      </MemoryRouter>,
    );

    await waitForSlideshow();
    const idBefore = getCurrentMediaId();
    expect(idBefore).not.toBeNull();

    const ws = getLatestWs();
    await act(async () => {
      ws.simulateMessage({
        type: "media_added",
        payload: makePhoto(99),
      });
    });

    // The currently displayed media must not change
    expect(getCurrentMediaId()).toBe(idBefore);
  });

  it("deleting non-current photo preserves the currently displayed media", async () => {
    mockFetch([makePhoto(1), makePhoto(2), makePhoto(3)]);

    render(
      <MemoryRouter>
        <SlideshowPage />
      </MemoryRouter>,
    );

    await waitForSlideshow();
    const idBefore = getCurrentMediaId();
    expect(idBefore).not.toBeNull();

    // Delete one that isn't current
    const toDelete = [1, 2, 3].find((id) => id !== idBefore)!;
    const ws = getLatestWs();
    await act(async () => {
      ws.simulateMessage({ type: "media_deleted", payload: { id: toDelete } });
    });

    // Current media must remain the same
    expect(getCurrentMediaId()).toBe(idBefore);
  });

  it("deleting the current photo advances to the next valid media", async () => {
    mockFetch([makePhoto(1), makePhoto(2), makePhoto(3)]);

    render(
      <MemoryRouter>
        <SlideshowPage />
      </MemoryRouter>,
    );

    await waitForSlideshow();
    const idBefore = getCurrentMediaId()!;
    const remaining = [1, 2, 3].filter((id) => id !== idBefore);

    const ws = getLatestWs();
    await act(async () => {
      ws.simulateMessage({ type: "media_deleted", payload: { id: idBefore } });
    });

    // Must advance to one of the remaining items
    const idAfter = getCurrentMediaId();
    expect(remaining).toContain(idAfter);
    expect(idAfter).not.toBe(idBefore);
  });

  it("navigation wraps forward and backward at boundaries", async () => {
    mockFetch([makePhoto(1), makePhoto(2)]);

    render(
      <MemoryRouter>
        <SlideshowPage />
      </MemoryRouter>,
    );

    await waitForSlideshow();
    const firstId = getCurrentMediaId()!;

    // ArrowRight to second
    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowRight" }),
      );
    });
    const secondId = getCurrentMediaId()!;
    expect(secondId).not.toBe(firstId);

    // ArrowRight again wraps back to first
    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowRight" }),
      );
    });
    expect(getCurrentMediaId()).toBe(firstId);

    // ArrowLeft wraps to end (second)
    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowLeft" }),
      );
    });
    expect(getCurrentMediaId()).toBe(secondId);
  });
});
