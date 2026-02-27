import { render, screen, fireEvent } from "@testing-library/react";
import PhotoCard from "../components/PhotoCard";
import type { Media } from "../api/client";

const mockMedia: Media = {
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
  uploaded_at: "2026-01-01T00:00:00",
};

const mockVideo: Media = {
  ...mockMedia,
  id: 2,
  media_type: "video",
  filename: "clip.mp4",
  original_name: "vacation.mp4",
  thumb_filename: "thumb_clip.jpg",
  duration: 3.5,
  codec: "h264",
};

describe("PhotoCard", () => {
  it("renders thumbnail image", () => {
    render(<PhotoCard media={mockMedia} onDelete={() => {}} />);
    const img = screen.getByAltText("sunset.jpg");
    expect(img).toBeInTheDocument();
    expect(img).toHaveAttribute("src", "/uploads/thumbnails/thumb_abc.jpg");
  });

  it("shows video badge for videos", () => {
    render(<PhotoCard media={mockVideo} onDelete={() => {}} />);
    expect(screen.getByText("Video")).toBeInTheDocument();
  });

  it("does not show video badge for photos", () => {
    render(<PhotoCard media={mockMedia} onDelete={() => {}} />);
    expect(screen.queryByText("Video")).not.toBeInTheDocument();
  });

  it("shows confirm dialog on delete click and calls onDelete", () => {
    const onDelete = vi.fn();
    render(<PhotoCard media={mockMedia} onDelete={onDelete} />);

    // Click delete button
    fireEvent.click(screen.getByLabelText("Delete sunset.jpg"));

    // Dialog should appear
    expect(screen.getByText("Delete media")).toBeInTheDocument();
    expect(screen.getAllByText(/sunset\.jpg/).length).toBeGreaterThanOrEqual(2);

    // Confirm deletion (the red button in the dialog)
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(onDelete).toHaveBeenCalledWith(1);
  });

  it("cancel does not call onDelete", () => {
    const onDelete = vi.fn();
    render(<PhotoCard media={mockMedia} onDelete={onDelete} />);

    fireEvent.click(screen.getByLabelText("Delete sunset.jpg"));
    fireEvent.click(screen.getByText("Cancel"));
    expect(onDelete).not.toHaveBeenCalled();
  });
});
