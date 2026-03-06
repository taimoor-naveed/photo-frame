import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import MediaDetailModal from "../components/MediaDetailModal";
import type { Media } from "../api/client";

const mockPhoto: Media = {
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
  display_filename: null,
  blur_filename: null,
  processing_status: "ready",
  content_hash: "abc123",
  uploaded_at: "2026-01-15T14:30:00",
};

const mockVideo: Media = {
  ...mockPhoto,
  id: 2,
  filename: "clip.mp4",
  original_name: "vacation.mp4",
  media_type: "video",
  thumb_filename: "thumb_clip.jpg",
  transcoded_filename: "transcoded_clip.webm",
  display_filename: null,
  duration: 15.5,
  codec: "h264",
};

const mockProcessingVideo: Media = {
  ...mockVideo,
  id: 3,
  processing_status: "processing",
  processing_progress: 42,
  transcoded_filename: null,
};

const mockErrorVideo: Media = {
  ...mockVideo,
  id: 4,
  processing_status: "error",
  transcoded_filename: null,
};

describe("MediaDetailModal", () => {
  it("renders nothing when media is null", () => {
    const { container } = render(
      <MediaDetailModal media={null} onClose={() => {}} onDelete={() => {}} />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("shows photo with correct src and data-media-id", () => {
    render(
      <MediaDetailModal
        media={mockPhoto}
        onClose={() => {}}
        onDelete={() => {}}
      />,
    );
    const img = screen.getByAltText("sunset.jpg");
    expect(img).toHaveAttribute("src", "/uploads/originals/abc.jpg");
    expect(img).toHaveAttribute("data-media-id", "1");
  });

  it("shows video with autoplay muted and correct src", () => {
    render(
      <MediaDetailModal
        media={mockVideo}
        onClose={() => {}}
        onDelete={() => {}}
      />,
    );
    const video = document.querySelector("video")!;
    expect(video).toBeTruthy();
    expect(video.src).toContain("/uploads/transcoded/transcoded_clip.webm");
    expect(video).toHaveAttribute("data-media-id", "2");
    expect(video.autoplay).toBe(true);
    expect(video.muted).toBe(true);
  });

  it("shows correct metadata values", () => {
    render(
      <MediaDetailModal
        media={mockPhoto}
        onClose={() => {}}
        onDelete={() => {}}
      />,
    );
    expect(screen.getByText("800 × 600")).toBeInTheDocument();
    expect(screen.getByText("12.1 KB")).toBeInTheDocument();
    // Check date is formatted (contains "Jan 15, 2026" or locale equivalent)
    expect(screen.getByText(/Jan/)).toBeInTheDocument();
  });

  it("close button calls onClose", () => {
    const onClose = vi.fn();
    render(
      <MediaDetailModal
        media={mockPhoto}
        onClose={onClose}
        onDelete={() => {}}
      />,
    );
    fireEvent.click(screen.getByLabelText("Close"));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("escape key closes modal", () => {
    const onClose = vi.fn();
    render(
      <MediaDetailModal
        media={mockPhoto}
        onClose={onClose}
        onDelete={() => {}}
      />,
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("backdrop click closes modal", () => {
    const onClose = vi.fn();
    render(
      <MediaDetailModal
        media={mockPhoto}
        onClose={onClose}
        onDelete={() => {}}
      />,
    );
    fireEvent.click(screen.getByTestId("media-detail-modal"));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("content click does NOT close modal", () => {
    const onClose = vi.fn();
    render(
      <MediaDetailModal
        media={mockPhoto}
        onClose={onClose}
        onDelete={() => {}}
      />,
    );
    fireEvent.click(screen.getByAltText("sunset.jpg"));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("delete button opens ConfirmDialog", () => {
    render(
      <MediaDetailModal
        media={mockPhoto}
        onClose={() => {}}
        onDelete={() => {}}
      />,
    );
    fireEvent.click(screen.getByLabelText("Delete"));
    expect(screen.getByText("Delete media")).toBeInTheDocument();
    expect(
      screen.getByText(/Are you sure you want to delete "sunset.jpg"/),
    ).toBeInTheDocument();
  });

  it("delete confirm calls onDelete with correct ID", () => {
    const onDelete = vi.fn();
    render(
      <MediaDetailModal
        media={mockPhoto}
        onClose={() => {}}
        onDelete={onDelete}
      />,
    );
    fireEvent.click(screen.getByLabelText("Delete"));
    // ConfirmDialog's red Delete button (not the trash icon which has aria-label only)
    const deleteButtons = screen.getAllByRole("button", { name: "Delete" });
    fireEvent.click(deleteButtons[deleteButtons.length - 1]);
    expect(onDelete).toHaveBeenCalledWith(1);
  });

  it("delete cancel keeps modal open", () => {
    render(
      <MediaDetailModal
        media={mockPhoto}
        onClose={() => {}}
        onDelete={() => {}}
      />,
    );
    fireEvent.click(screen.getByLabelText("Delete"));
    fireEvent.click(screen.getByText("Cancel"));
    // Modal still visible
    expect(screen.getByTestId("media-detail-modal")).toBeInTheDocument();
    // Confirm dialog dismissed
    expect(
      screen.queryByText(/Are you sure you want to delete/),
    ).not.toBeInTheDocument();
  });

  it("shows duration for videos", () => {
    render(
      <MediaDetailModal
        media={mockVideo}
        onClose={() => {}}
        onDelete={() => {}}
      />,
    );
    expect(screen.getByText("16s")).toBeInTheDocument();
  });

  // ─── Download Button ───────────────────────────────────

  it("renders download button with correct href for photo", () => {
    render(
      <MediaDetailModal
        media={mockPhoto}
        onClose={() => {}}
        onDelete={() => {}}
      />,
    );
    const downloadLink = screen.getByLabelText("Download");
    expect(downloadLink).toHaveAttribute("href", "/uploads/originals/abc.jpg");
    expect(downloadLink).toHaveAttribute("download", "sunset.jpg");
  });

  it("renders download button with correct href for transcoded video", () => {
    render(
      <MediaDetailModal
        media={mockVideo}
        onClose={() => {}}
        onDelete={() => {}}
      />,
    );
    const downloadLink = screen.getByLabelText("Download");
    // Download should use originalUrl (transcoded path for transcoded video)
    expect(downloadLink).toHaveAttribute("href", "/uploads/transcoded/transcoded_clip.webm");
    expect(downloadLink).toHaveAttribute("download", "vacation.mp4");
  });

  it("download button uses originalUrl, not displayUrl (always full quality)", () => {
    const photoWithDisplay: Media = {
      ...mockPhoto,
      display_filename: "display_abc.jpg",
    };
    render(
      <MediaDetailModal
        media={photoWithDisplay}
        onClose={() => {}}
        onDelete={() => {}}
      />,
    );
    const downloadLink = screen.getByLabelText("Download");
    // Must download original, NOT display version
    expect(downloadLink).toHaveAttribute("href", "/uploads/originals/abc.jpg");
    expect(downloadLink.getAttribute("href")).not.toContain("display");
  });

  it("does not show duration for photos", () => {
    render(
      <MediaDetailModal
        media={mockPhoto}
        onClose={() => {}}
        onDelete={() => {}}
      />,
    );
    // No duration-like text (Xs or Xm) should appear
    expect(screen.queryByText(/^\d+s$/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^\d+m$/)).not.toBeInTheDocument();
  });

  // ─── Show in Slideshow Button ───────────────────────────

  it("renders 'Show in slideshow' button", () => {
    render(
      <MediaDetailModal
        media={mockPhoto}
        onClose={() => {}}
        onDelete={() => {}}
      />,
    );
    expect(screen.getByLabelText("Show in slideshow")).toBeInTheDocument();
  });

  it("calls slideshow jump API on click", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true }),
    } as Response);

    render(
      <MediaDetailModal
        media={mockPhoto}
        onClose={() => {}}
        onDelete={() => {}}
      />,
    );

    fireEvent.click(screen.getByLabelText("Show in slideshow"));

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        "/api/media/slideshow/jump",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ media_id: 1 }),
        }),
      );
    });

    fetchSpy.mockRestore();
  });

  it("shows error banner when slideshow jump API fails", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => "Internal Server Error",
    } as Response);

    render(
      <MediaDetailModal
        media={mockPhoto}
        onClose={() => {}}
        onDelete={() => {}}
      />,
    );

    fireEvent.click(screen.getByLabelText("Show in slideshow"));

    await waitFor(() => {
      expect(screen.getByText(/Failed to jump slideshow/)).toBeInTheDocument();
    });

    fetchSpy.mockRestore();
  });

  it("clears jump error when media changes", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => "Internal Server Error",
    } as Response);

    const { rerender } = render(
      <MediaDetailModal
        media={mockPhoto}
        onClose={() => {}}
        onDelete={() => {}}
      />,
    );

    fireEvent.click(screen.getByLabelText("Show in slideshow"));

    await waitFor(() => {
      expect(screen.getByText(/Failed to jump slideshow/)).toBeInTheDocument();
    });

    // Switch to different media — error should clear
    rerender(
      <MediaDetailModal
        media={mockVideo}
        onClose={() => {}}
        onDelete={() => {}}
      />,
    );

    expect(screen.queryByText(/Failed to jump slideshow/)).not.toBeInTheDocument();

    fetchSpy.mockRestore();
  });

  // ─── Processing/Error State in Modal ──────────────────────

  it("shows processing overlay instead of video player for processing video", () => {
    render(
      <MediaDetailModal
        media={mockProcessingVideo}
        onClose={() => {}}
        onDelete={() => {}}
      />,
    );
    expect(document.querySelector("video")).toBeNull();
    const img = screen.getByAltText("vacation.mp4");
    expect(img).toHaveAttribute("src", "/uploads/thumbnails/thumb_clip.jpg");
    expect(screen.getByText("42%")).toBeInTheDocument();
  });

  it("shows error overlay instead of video player for error video", () => {
    render(
      <MediaDetailModal
        media={mockErrorVideo}
        onClose={() => {}}
        onDelete={() => {}}
      />,
    );
    expect(document.querySelector("video")).toBeNull();
    const img = screen.getByAltText("vacation.mp4");
    expect(img).toHaveAttribute("src", "/uploads/thumbnails/thumb_clip.jpg");
    expect(screen.getByText("Failed")).toBeInTheDocument();
  });

  // ─── Jump Button State for Processing/Error ─────────────

  it("jump button is disabled for processing media", () => {
    render(
      <MediaDetailModal
        media={mockProcessingVideo}
        onClose={() => {}}
        onDelete={() => {}}
      />,
    );
    const jumpBtn = screen.getByLabelText("Show in slideshow");
    expect(jumpBtn).toBeDisabled();
    expect(jumpBtn).toHaveAttribute("title", "Not available while processing");
  });

  it("jump button is disabled for error media", () => {
    render(
      <MediaDetailModal
        media={mockErrorVideo}
        onClose={() => {}}
        onDelete={() => {}}
      />,
    );
    const jumpBtn = screen.getByLabelText("Show in slideshow");
    expect(jumpBtn).toBeDisabled();
    expect(jumpBtn).toHaveAttribute("title", "Not available for failed media");
  });

  it("jump button is enabled for ready media", () => {
    render(
      <MediaDetailModal
        media={mockPhoto}
        onClose={() => {}}
        onDelete={() => {}}
      />,
    );
    const jumpBtn = screen.getByLabelText("Show in slideshow");
    expect(jumpBtn).not.toBeDisabled();
    expect(jumpBtn).not.toHaveAttribute("title");
  });

  it("delete button works on processing media", () => {
    const onDelete = vi.fn();
    render(
      <MediaDetailModal
        media={mockProcessingVideo}
        onClose={() => {}}
        onDelete={onDelete}
      />,
    );
    fireEvent.click(screen.getByLabelText("Delete"));
    expect(screen.getByText("Delete media")).toBeInTheDocument();
    const deleteButtons = screen.getAllByRole("button", { name: "Delete" });
    fireEvent.click(deleteButtons[deleteButtons.length - 1]);
    expect(onDelete).toHaveBeenCalledWith(3);
  });

  it("delete button works on error media", () => {
    const onDelete = vi.fn();
    render(
      <MediaDetailModal
        media={mockErrorVideo}
        onClose={() => {}}
        onDelete={onDelete}
      />,
    );
    fireEvent.click(screen.getByLabelText("Delete"));
    const deleteButtons = screen.getAllByRole("button", { name: "Delete" });
    fireEvent.click(deleteButtons[deleteButtons.length - 1]);
    expect(onDelete).toHaveBeenCalledWith(4);
  });

  it("jump button does not call API when disabled (processing)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    render(
      <MediaDetailModal
        media={mockProcessingVideo}
        onClose={() => {}}
        onDelete={() => {}}
      />,
    );
    fireEvent.click(screen.getByLabelText("Show in slideshow"));
    // Give any potential async call time to fire
    await new Promise((r) => setTimeout(r, 50));
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("updates progress when media prop changes (live WS updates)", () => {
    const { rerender } = render(
      <MediaDetailModal
        media={mockProcessingVideo}
        onClose={() => {}}
        onDelete={() => {}}
      />,
    );
    expect(screen.getByText("42%")).toBeInTheDocument();

    // Simulate WS update with new progress
    const updatedMedia: Media = { ...mockProcessingVideo, processing_progress: 78 };
    rerender(
      <MediaDetailModal
        media={updatedMedia}
        onClose={() => {}}
        onDelete={() => {}}
      />,
    );
    expect(screen.getByText("78%")).toBeInTheDocument();
    expect(screen.queryByText("42%")).not.toBeInTheDocument();
  });

  it("jump button enables when media transitions from processing to ready", () => {
    const { rerender } = render(
      <MediaDetailModal
        media={mockProcessingVideo}
        onClose={() => {}}
        onDelete={() => {}}
      />,
    );
    expect(screen.getByLabelText("Show in slideshow")).toBeDisabled();

    // Simulate processing complete
    const readyMedia: Media = {
      ...mockProcessingVideo,
      processing_status: "ready",
      processing_progress: 100,
      transcoded_filename: "transcoded_clip.webm",
    };
    rerender(
      <MediaDetailModal
        media={readyMedia}
        onClose={() => {}}
        onDelete={() => {}}
      />,
    );
    expect(screen.getByLabelText("Show in slideshow")).not.toBeDisabled();
    // Should now show the video player instead of processing overlay
    expect(document.querySelector("video")).toBeTruthy();
  });

  it("jump button has no visible focus ring on click", () => {
    render(
      <MediaDetailModal
        media={mockPhoto}
        onClose={() => {}}
        onDelete={() => {}}
      />,
    );
    const jumpBtn = screen.getByLabelText("Show in slideshow");
    expect(jumpBtn.className).toContain("focus:outline-none");
  });

  it("shows processing overlay for processing photo", () => {
    const processingPhoto: Media = {
      ...mockPhoto,
      processing_status: "processing",
      processing_progress: 75,
    };
    render(
      <MediaDetailModal
        media={processingPhoto}
        onClose={() => {}}
        onDelete={() => {}}
      />,
    );
    const imgs = screen.getAllByAltText("sunset.jpg");
    const hasThumbnail = imgs.some((img) =>
      img.getAttribute("src")?.includes("/uploads/thumbnails/"),
    );
    expect(hasThumbnail).toBe(true);
    expect(screen.getByText("75%")).toBeInTheDocument();
  });
});
