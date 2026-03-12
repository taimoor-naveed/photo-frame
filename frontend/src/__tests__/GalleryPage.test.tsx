import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import GalleryPage from "../pages/GalleryPage";
import type { MediaList, Media } from "../api/client";

const mockMedia1: Media = {
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
  display_filename: null,

  processing_status: "ready" as const,
  content_hash: "abc123",
  uploaded_at: "2026-01-01T00:00:00",
};

const mockMedia2: Media = {
  ...mockMedia1,
  id: 2,
  filename: "def.jpg",
  original_name: "photo2.jpg",
  thumb_filename: "thumb_def.jpg",
  content_hash: "def456",
};

const mockMedia3: Media = {
  ...mockMedia1,
  id: 3,
  filename: "ghi.jpg",
  original_name: "photo3.jpg",
  thumb_filename: "thumb_ghi.jpg",
  content_hash: "ghi789",
};

const mockList: MediaList = {
  items: [mockMedia1],
  total: 1,
  page: 1,
  per_page: 50,
};

const mockList3: MediaList = {
  items: [mockMedia1, mockMedia2, mockMedia3],
  total: 3,
  page: 1,
  per_page: 50,
};

// Mock IntersectionObserver for infinite scroll tests
let intersectionCallback: IntersectionObserverCallback | null = null;
let observerConstructCount = 0;

class MockIntersectionObserver {
  constructor(callback: IntersectionObserverCallback) {
    intersectionCallback = callback;
    observerConstructCount++;
  }
  observe = vi.fn();
  disconnect = vi.fn();
  unobserve = vi.fn();
}

// Mock WebSocket
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

beforeEach(() => {
  wsInstances = [];
  intersectionCallback = null;
  observerConstructCount = 0;
  vi.restoreAllMocks();
  vi.useFakeTimers({ shouldAdvanceTime: true });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.stubGlobal("IntersectionObserver", MockIntersectionObserver as any);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.stubGlobal("WebSocket", MockWS as any);
});

afterEach(() => {
  vi.useRealTimers();
});

function renderGallery() {
  return render(
    <MemoryRouter>
      <GalleryPage />
    </MemoryRouter>,
  );
}

async function waitForPhotos() {
  await waitFor(() => {
    expect(screen.getByText("Gallery")).toBeInTheDocument();
  });
}

/** Simulate long-press on a photo card by its index.
 * Includes the click event that browsers fire after pointerUp,
 * which the component swallows via the didLongPress ref. */
function longPressCard(index: number) {
  const cards = screen.getAllByTestId("photo-card");
  fireEvent.pointerDown(cards[index]);
  act(() => { vi.advanceTimersByTime(500); });
  fireEvent.pointerUp(cards[index]);
  fireEvent.click(cards[index]); // browser fires click after pointerUp; component swallows it
}

describe("GalleryPage", () => {
  it("shows loading skeletons initially", () => {
    vi.spyOn(globalThis, "fetch").mockReturnValue(new Promise(() => {})); // never resolves
    const { container } = renderGallery();
    expect(container.querySelectorAll(".animate-pulse").length).toBeGreaterThan(0);
  });

  it("shows empty state when no photos", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => ({ items: [], total: 0, page: 1, per_page: 50 }),
    } as Response);

    renderGallery();

    await waitFor(() => {
      expect(screen.getByText("Your gallery awaits")).toBeInTheDocument();
    });
    expect(screen.getByText("Upload Photos")).toBeInTheDocument();
  });

  it("renders photo grid when photos exist", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => mockList,
    } as Response);

    renderGallery();

    await waitFor(() => {
      expect(screen.getByText("Gallery")).toBeInTheDocument();
    });
    expect(screen.getByAltText("photo.jpg")).toBeInTheDocument();
  });

  it("shows error state on fetch failure", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => "Server error",
    } as Response);

    renderGallery();

    await waitFor(() => {
      expect(screen.getByText("Retry")).toBeInTheDocument();
    });
  });

  it("click photo card opens modal with correct data-media-id", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => mockList,
    } as Response);

    renderGallery();

    await waitFor(() => {
      expect(screen.getByAltText("photo.jpg")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("photo-card"));
    expect(screen.getByTestId("media-detail-modal")).toBeInTheDocument();
    expect(
      screen.getByTestId("media-detail-modal").querySelector("[data-media-id='1']"),
    ).toBeInTheDocument();
  });

  it("delete from modal removes photo and closes modal", async () => {
    // First fetch: list with one photo
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => mockList,
    } as Response);

    renderGallery();

    await waitFor(() => {
      expect(screen.getByAltText("photo.jpg")).toBeInTheDocument();
    });

    // Open modal
    fireEvent.click(screen.getByTestId("photo-card"));
    expect(screen.getByTestId("media-detail-modal")).toBeInTheDocument();

    // Mock delete API call + refetch with empty list
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({}),
    } as Response);
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ items: [], total: 0, page: 1, per_page: 50 }),
    } as Response);

    // Click trash (modal's delete button, not PhotoCard's)
    fireEvent.click(screen.getByLabelText("Delete"));
    // ConfirmDialog's red Delete button (last one matching)
    const deleteButtons = screen.getAllByRole("button", { name: "Delete" });
    fireEvent.click(deleteButtons[deleteButtons.length - 1]);

    // Modal should close
    await waitFor(() => {
      expect(screen.queryByTestId("media-detail-modal")).not.toBeInTheDocument();
    });

    // Photo should be gone
    await waitFor(() => {
      expect(screen.getByText("Your gallery awaits")).toBeInTheDocument();
    });
  });

  // ─── Selection Mode Tests ─────────────────────────────────

  it("long-press on card enters selection mode and shows action bar", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => mockList3,
    } as Response);

    renderGallery();
    await waitForPhotos();

    longPressCard(0);

    expect(screen.getByTestId("selection-action-bar")).toBeInTheDocument();
    expect(screen.getByText("1 item selected")).toBeInTheDocument();
  });

  it("click toggles selection in selection mode", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => mockList3,
    } as Response);

    renderGallery();
    await waitForPhotos();

    // Enter selection mode via long-press on first card
    longPressCard(0);
    expect(screen.getByText("1 item selected")).toBeInTheDocument();

    // Click second card to select it too
    const cards = screen.getAllByTestId("photo-card");
    fireEvent.click(cards[1]);
    expect(screen.getByText("2 items selected")).toBeInTheDocument();

    // Click first card to deselect it
    fireEvent.click(cards[0]);
    expect(screen.getByText("1 item selected")).toBeInTheDocument();
  });

  it("click opens modal in normal mode, not in selection mode", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => mockList3,
    } as Response);

    renderGallery();
    await waitForPhotos();

    // Normal click opens modal
    fireEvent.click(screen.getAllByTestId("photo-card")[0]);
    expect(screen.getByTestId("media-detail-modal")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Close"));

    await waitFor(() => {
      expect(screen.queryByTestId("media-detail-modal")).not.toBeInTheDocument();
    });

    // Enter selection mode
    longPressCard(0);
    expect(screen.getByTestId("selection-action-bar")).toBeInTheDocument();

    // Click in selection mode should NOT open modal
    fireEvent.click(screen.getAllByTestId("photo-card")[1]);
    expect(screen.queryByTestId("media-detail-modal")).not.toBeInTheDocument();
  });

  it("cancel exits selection mode and hides action bar", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => mockList3,
    } as Response);

    renderGallery();
    await waitForPhotos();

    longPressCard(0);
    expect(screen.getByTestId("selection-action-bar")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("selection-cancel"));
    expect(screen.queryByTestId("selection-action-bar")).not.toBeInTheDocument();
  });

  it("escape key exits selection mode", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => mockList3,
    } as Response);

    renderGallery();
    await waitForPhotos();

    longPressCard(0);
    expect(screen.getByTestId("selection-action-bar")).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByTestId("selection-action-bar")).not.toBeInTheDocument();
  });

  it("bulk delete calls API and exits selection mode", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => mockList3,
    } as Response);

    renderGallery();
    await waitForPhotos();

    // Select 2 items
    longPressCard(0);
    fireEvent.click(screen.getAllByTestId("photo-card")[1]);
    expect(screen.getByText("2 items selected")).toBeInTheDocument();

    // Mock bulk delete + refetch
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ deleted: [1, 2], not_found: [] }),
    } as Response);
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ items: [mockMedia3], total: 1, page: 1, per_page: 50 }),
    } as Response);

    // Click delete, then confirm
    fireEvent.click(screen.getByTestId("selection-delete"));
    const confirmBtn = screen.getAllByRole("button", { name: "Delete" });
    fireEvent.click(confirmBtn[confirmBtn.length - 1]);

    // Selection mode should exit
    await waitFor(() => {
      expect(screen.queryByTestId("selection-action-bar")).not.toBeInTheDocument();
    });

    // Verify the bulk delete API was called
    const bulkCall = fetchSpy.mock.calls.find(
      (call) => typeof call[0] === "string" && call[0].includes("/media/bulk"),
    );
    expect(bulkCall).toBeDefined();
  });

  // ─── Processing/Error Interaction Tests ──────────────────

  it("long-press on processing item enters selection mode", async () => {
    const processingMedia: Media = {
      ...mockMedia1,
      id: 10,
      processing_status: "processing" as const,
    };
    const listWithProcessing: MediaList = {
      items: [mockMedia1, processingMedia],
      total: 2,
      page: 1,
      per_page: 50,
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => listWithProcessing,
    } as Response);

    renderGallery();
    await waitForPhotos();

    // Long-press the processing item (index 1)
    longPressCard(1);

    expect(screen.getByTestId("selection-action-bar")).toBeInTheDocument();
    expect(screen.getByText("1 item selected")).toBeInTheDocument();
  });

  it("click on processing item opens modal", async () => {
    const processingMedia: Media = {
      ...mockMedia1,
      id: 10,
      processing_status: "processing" as const,
      processing_progress: 50,
    };
    const listWithProcessing: MediaList = {
      items: [processingMedia],
      total: 1,
      page: 1,
      per_page: 50,
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => listWithProcessing,
    } as Response);

    renderGallery();
    await waitForPhotos();

    fireEvent.click(screen.getByTestId("photo-card"));
    expect(screen.getByTestId("media-detail-modal")).toBeInTheDocument();
    // Should show processing overlay — no video element
    expect(document.querySelector("video")).toBeNull();
  });

  it("select all says 'Select all loaded' when more items exist", async () => {
    // Simulate a page where hasMore is true (total > loaded items)
    const items = Array.from({ length: 3 }, (_, i) => ({
      ...mockMedia1,
      id: i + 1,
      filename: `photo${i + 1}.jpg`,
      original_name: `photo${i + 1}.jpg`,
      thumb_filename: `thumb_photo${i + 1}.jpg`,
      content_hash: `hash${i + 1}`,
    }));
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => ({ items, total: 100, page: 1, per_page: 50 }),
    } as Response);

    renderGallery();
    await waitForPhotos();

    longPressCard(0);
    expect(screen.getByText("Select all loaded")).toBeInTheDocument();
  });

  it("select all selects all photos", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => mockList3,
    } as Response);

    renderGallery();
    await waitForPhotos();

    longPressCard(0);
    fireEvent.click(screen.getByTestId("selection-select-all"));
    expect(screen.getByText("3 items selected")).toBeInTheDocument();
  });

  // ─── Infinite Scroll Tests ───────────────────────────────

  it("shows sentinel when hasMore is true", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => ({ items: [mockMedia1], total: 100, page: 1, per_page: 50 }),
    } as Response);

    renderGallery();
    await waitForPhotos();

    // IntersectionObserver should have been constructed (sentinel exists)
    expect(intersectionCallback).not.toBeNull();
  });

  it("does not show sentinel when all items loaded", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => mockList,
    } as Response);

    renderGallery();
    await waitForPhotos();

    // With only 1 item and total=1, hasMore is false — no observer created
    expect(intersectionCallback).toBeNull();
  });

  it("load-more failure shows inline error, not full-page error", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ items: [mockMedia1], total: 3, page: 1, per_page: 50 }),
      } as Response)
      // Page 2 fails
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => "Server error",
      } as Response);

    renderGallery();
    await waitForPhotos();

    // Trigger infinite scroll
    await act(async () => {
      intersectionCallback!(
        [{ isIntersecting: true }] as IntersectionObserverEntry[],
        {} as IntersectionObserver,
      );
    });

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2));

    // Gallery grid must still be visible (not replaced by full-page error)
    expect(screen.getByText("Gallery")).toBeInTheDocument();
    expect(screen.getByTestId("photo-card")).toBeInTheDocument();

    // Inline load-more error should be shown with retry
    await waitFor(() => {
      expect(screen.getByTestId("load-more-error")).toBeInTheDocument();
    });
    expect(screen.getByText("Retry")).toBeInTheDocument();
  });

  it("load-more retry button triggers another fetchNextPage", async () => {
    const page2Items = [mockMedia2, mockMedia3];
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ items: [mockMedia1], total: 3, page: 1, per_page: 50 }),
      } as Response)
      // Page 2 fails first time
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => "Server error",
      } as Response)
      // Page 2 succeeds on retry
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ items: page2Items, total: 3, page: 2, per_page: 50 }),
      } as Response);

    renderGallery();
    await waitForPhotos();

    // Trigger intersection — fails
    await act(async () => {
      intersectionCallback!(
        [{ isIntersecting: true }] as IntersectionObserverEntry[],
        {} as IntersectionObserver,
      );
    });

    await waitFor(() => {
      expect(screen.getByTestId("load-more-error")).toBeInTheDocument();
    });

    // Click retry
    fireEvent.click(screen.getByText("Retry"));

    // Should succeed and show all 3 items
    await waitFor(() => {
      expect(screen.getAllByTestId("photo-card")).toHaveLength(3);
    });
    expect(screen.queryByTestId("load-more-error")).not.toBeInTheDocument();
  });

  it("does not auto-retry when load-more error is present", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ items: [mockMedia1], total: 3, page: 1, per_page: 50 }),
      } as Response)
      // Page 2 fails
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => "Server error",
      } as Response);

    renderGallery();
    await waitForPhotos();

    // Wait for observer to be created
    await waitFor(() => expect(intersectionCallback).not.toBeNull());
    const countBeforeIntersection = observerConstructCount;

    // Trigger intersection — fails
    await act(async () => {
      intersectionCallback!(
        [{ isIntersecting: true }] as IntersectionObserverEntry[],
        {} as IntersectionObserver,
      );
    });

    await waitFor(() => {
      expect(screen.getByTestId("load-more-error")).toBeInTheDocument();
    });

    // The observer effect re-runs when loadingMore flips back to false.
    // With loadMoreError set, the effect should return early — no new
    // IntersectionObserver should be constructed. In a real browser this
    // means no automatic callback, preventing a retry loop.
    expect(observerConstructCount).toBe(countBeforeIntersection);
  });

  it("loads next page when sentinel becomes visible", async () => {
    const page2Items = [mockMedia2, mockMedia3];
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ items: [mockMedia1], total: 3, page: 1, per_page: 50 }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ items: page2Items, total: 3, page: 2, per_page: 50 }),
      } as Response);

    renderGallery();
    await waitForPhotos();

    // Trigger intersection
    await act(async () => {
      intersectionCallback!(
        [{ isIntersecting: true }] as IntersectionObserverEntry[],
        {} as IntersectionObserver,
      );
    });

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2));
    const page2Url = fetchSpy.mock.calls[1][0] as string;
    expect(page2Url).toContain("page=2");

    // All 3 photos should be visible
    await waitFor(() => {
      expect(screen.getAllByTestId("photo-card")).toHaveLength(3);
    });
  });
});
