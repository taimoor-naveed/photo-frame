import { render, screen, fireEvent } from "@testing-library/react";
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
  duration: 15.5,
  codec: "h264",
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
});
