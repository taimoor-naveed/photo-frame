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
  transcoded_filename: null,
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

beforeEach(() => {
  vi.restoreAllMocks();
  vi.useFakeTimers({ shouldAdvanceTime: true });
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
});
