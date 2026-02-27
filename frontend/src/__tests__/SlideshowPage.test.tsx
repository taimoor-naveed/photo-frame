import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import SlideshowPage from "../pages/SlideshowPage";
import type { MediaList, Settings } from "../api/client";

const mockSettings: Settings = {
  slideshow_interval: 10,
  transition_type: "crossfade",
  photo_order: "sequential",
};

const mockMedia: MediaList = {
  items: [
    {
      id: 1,
      filename: "abc.jpg",
      original_name: "sunset.jpg",
      media_type: "photo",
      width: 800,
      height: 600,
      file_size: 12345,
      duration: null,
      codec: null,
      thumb_filename: "thumb_abc.jpg",
      transcoded_filename: null,
      uploaded_at: "2026-01-01T00:00:00",
    },
    {
      id: 2,
      filename: "def.mp4",
      original_name: "clip.mp4",
      media_type: "video",
      width: 1920,
      height: 1080,
      file_size: 99999,
      duration: 3.5,
      codec: "h264",
      thumb_filename: "thumb_def.jpg",
      transcoded_filename: null,
      uploaded_at: "2026-01-02T00:00:00",
    },
  ],
  total: 2,
  page: 1,
  per_page: 1000,
};

// Mock WebSocket globally
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
    vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      if (url.includes("/media")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ items: [], total: 0, page: 1, per_page: 1000 }),
        } as Response);
      }
      return Promise.resolve({
        ok: true,
        json: async () => mockSettings,
      } as Response);
    });

    render(
      <MemoryRouter>
        <SlideshowPage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText("No photos to display")).toBeInTheDocument();
    });
    expect(screen.getByText("Upload photos to start slideshow")).toBeInTheDocument();
  });

  it("renders first photo when media exists", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      if (url.includes("/media")) {
        return Promise.resolve({
          ok: true,
          json: async () => mockMedia,
        } as Response);
      }
      return Promise.resolve({
        ok: true,
        json: async () => mockSettings,
      } as Response);
    });

    render(
      <MemoryRouter>
        <SlideshowPage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByAltText("sunset.jpg")).toBeInTheDocument();
    });
  });

  it("shows pause indicator when space pressed", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      if (url.includes("/media")) {
        return Promise.resolve({
          ok: true,
          json: async () => mockMedia,
        } as Response);
      }
      return Promise.resolve({
        ok: true,
        json: async () => mockSettings,
      } as Response);
    });

    render(
      <MemoryRouter>
        <SlideshowPage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByAltText("sunset.jpg")).toBeInTheDocument();
    });

    // Press space to pause
    window.dispatchEvent(new KeyboardEvent("keydown", { key: " " }));

    await waitFor(() => {
      expect(screen.getByText("Paused")).toBeInTheDocument();
    });
  });
});
