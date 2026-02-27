import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import GalleryPage from "../pages/GalleryPage";
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

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("GalleryPage", () => {
  it("shows loading skeletons initially", () => {
    vi.spyOn(globalThis, "fetch").mockReturnValue(new Promise(() => {})); // never resolves
    const { container } = render(
      <MemoryRouter>
        <GalleryPage />
      </MemoryRouter>,
    );
    expect(container.querySelectorAll(".animate-pulse").length).toBeGreaterThan(0);
  });

  it("shows empty state when no photos", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => ({ items: [], total: 0, page: 1, per_page: 50 }),
    } as Response);

    render(
      <MemoryRouter>
        <GalleryPage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText("No photos yet")).toBeInTheDocument();
    });
    expect(screen.getByText("Upload Photos")).toBeInTheDocument();
  });

  it("renders photo grid when photos exist", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => mockList,
    } as Response);

    render(
      <MemoryRouter>
        <GalleryPage />
      </MemoryRouter>,
    );

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

    render(
      <MemoryRouter>
        <GalleryPage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText("Retry")).toBeInTheDocument();
    });
  });

  it("click photo card opens modal with correct data-media-id", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => mockList,
    } as Response);

    render(
      <MemoryRouter>
        <GalleryPage />
      </MemoryRouter>,
    );

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

    render(
      <MemoryRouter>
        <GalleryPage />
      </MemoryRouter>,
    );

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
      expect(screen.getByText("No photos yet")).toBeInTheDocument();
    });
  });
});
