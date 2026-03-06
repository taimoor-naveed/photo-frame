import { render, screen, fireEvent, act } from "@testing-library/react";
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
  display_filename: null,
  blur_filename: null,
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

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("PhotoCard", () => {
  it("renders thumbnail image", () => {
    render(<PhotoCard media={mockMedia} />);
    const img = screen.getByAltText("sunset.jpg");
    expect(img).toBeInTheDocument();
    expect(img).toHaveAttribute("src", "/uploads/thumbnails/thumb_abc.jpg");
  });

  it("shows video badge for videos", () => {
    render(<PhotoCard media={mockVideo} />);
    expect(screen.getByText("Video")).toBeInTheDocument();
  });

  it("does not show video badge for photos", () => {
    render(<PhotoCard media={mockMedia} />);
    expect(screen.queryByText("Video")).not.toBeInTheDocument();
  });

  it("card click calls onClick with media object", () => {
    const onClick = vi.fn();
    render(<PhotoCard media={mockMedia} onClick={onClick} />);
    fireEvent.click(screen.getByTestId("photo-card"));
    expect(onClick).toHaveBeenCalledWith(mockMedia);
  });

  it("calls onClick when processing (opens modal)", () => {
    const onClick = vi.fn();
    const processing = { ...mockMedia, processing_status: "processing" as const };
    render(<PhotoCard media={processing} onClick={onClick} />);
    fireEvent.click(screen.getByTestId("photo-card"));
    expect(onClick).toHaveBeenCalledWith(processing);
  });

  it("calls onClick when error state", () => {
    const onClick = vi.fn();
    const errorMedia = { ...mockMedia, processing_status: "error" as const };
    render(<PhotoCard media={errorMedia} onClick={onClick} />);
    fireEvent.click(screen.getByTestId("photo-card"));
    expect(onClick).toHaveBeenCalledWith(errorMedia);
  });

  it("click in selection mode toggles processing items", () => {
    const onToggleSelect = vi.fn();
    const processing = { ...mockMedia, processing_status: "processing" as const };
    render(
      <PhotoCard
        media={processing}
        selectionMode={true}
        onToggleSelect={onToggleSelect}
      />,
    );
    fireEvent.click(screen.getByTestId("photo-card"));
    expect(onToggleSelect).toHaveBeenCalledWith(processing);
  });

  // ─── Long-press tests ────────────────────────────────────

  it("fires onLongPress after 500ms pointer hold", () => {
    const onLongPress = vi.fn();
    render(<PhotoCard media={mockMedia} onLongPress={onLongPress} />);
    const card = screen.getByTestId("photo-card");

    fireEvent.pointerDown(card);
    act(() => { vi.advanceTimersByTime(500); });

    expect(onLongPress).toHaveBeenCalledWith(mockMedia);
  });

  it("does not fire onLongPress if pointer released before 500ms", () => {
    const onLongPress = vi.fn();
    render(<PhotoCard media={mockMedia} onLongPress={onLongPress} />);
    const card = screen.getByTestId("photo-card");

    fireEvent.pointerDown(card);
    act(() => { vi.advanceTimersByTime(300); });
    fireEvent.pointerUp(card);
    act(() => { vi.advanceTimersByTime(500); });

    expect(onLongPress).not.toHaveBeenCalled();
  });

  it("click does not fire onClick after long-press", () => {
    const onClick = vi.fn();
    const onLongPress = vi.fn();
    render(<PhotoCard media={mockMedia} onClick={onClick} onLongPress={onLongPress} />);
    const card = screen.getByTestId("photo-card");

    fireEvent.pointerDown(card);
    act(() => { vi.advanceTimersByTime(500); });
    fireEvent.pointerUp(card);
    fireEvent.click(card);

    expect(onLongPress).toHaveBeenCalledOnce();
    expect(onClick).not.toHaveBeenCalled();
  });

  it("fires onLongPress on processing items", () => {
    const onLongPress = vi.fn();
    const processing = { ...mockMedia, processing_status: "processing" as const };
    render(<PhotoCard media={processing} onLongPress={onLongPress} />);
    const card = screen.getByTestId("photo-card");

    fireEvent.pointerDown(card);
    act(() => { vi.advanceTimersByTime(500); });

    expect(onLongPress).toHaveBeenCalledWith(processing);
  });

  it("fires onLongPress on error items", () => {
    const onLongPress = vi.fn();
    const errorMedia = { ...mockMedia, processing_status: "error" as const };
    render(<PhotoCard media={errorMedia} onLongPress={onLongPress} />);
    const card = screen.getByTestId("photo-card");

    fireEvent.pointerDown(card);
    act(() => { vi.advanceTimersByTime(500); });

    expect(onLongPress).toHaveBeenCalledWith(errorMedia);
  });

  // ─── Selection mode visual tests ─────────────────────────

  it("shows selection indicator on processing items in selection mode", () => {
    const processing = { ...mockMedia, processing_status: "processing" as const };
    render(<PhotoCard media={processing} selectionMode={true} selected={false} />);
    expect(screen.getByTestId("selection-indicator")).toBeInTheDocument();
    expect(screen.getByTestId("selection-unchecked")).toBeInTheDocument();
  });

  it("shows selection checked on selected processing items", () => {
    const processing = { ...mockMedia, processing_status: "processing" as const };
    render(<PhotoCard media={processing} selectionMode={true} selected={true} />);
    expect(screen.getByTestId("selection-checked")).toBeInTheDocument();
  });

  it("shows empty selection circle in selection mode when not selected", () => {
    render(<PhotoCard media={mockMedia} selectionMode={true} selected={false} />);
    expect(screen.getByTestId("selection-indicator")).toBeInTheDocument();
    expect(screen.getByTestId("selection-unchecked")).toBeInTheDocument();
    expect(screen.queryByTestId("selection-checked")).not.toBeInTheDocument();
  });

  it("shows filled checkmark circle when selected", () => {
    render(<PhotoCard media={mockMedia} selectionMode={true} selected={true} />);
    expect(screen.getByTestId("selection-checked")).toBeInTheDocument();
    expect(screen.queryByTestId("selection-unchecked")).not.toBeInTheDocument();
  });

  it("shows blue ring on card when selected", () => {
    render(<PhotoCard media={mockMedia} selectionMode={true} selected={true} />);
    const card = screen.getByTestId("photo-card");
    expect(card.className).toContain("ring-2");
    expect(card.className).toContain("ring-copper");
  });

  it("no selection UI in normal mode", () => {
    render(<PhotoCard media={mockMedia} />);
    expect(screen.queryByTestId("selection-indicator")).not.toBeInTheDocument();
  });

  // ─── Click behavior in selection mode ─────────────────────

  it("click in selection mode calls onToggleSelect, not onClick", () => {
    const onClick = vi.fn();
    const onToggleSelect = vi.fn();
    render(
      <PhotoCard
        media={mockMedia}
        selectionMode={true}
        onClick={onClick}
        onToggleSelect={onToggleSelect}
      />,
    );
    fireEvent.click(screen.getByTestId("photo-card"));
    expect(onToggleSelect).toHaveBeenCalledWith(mockMedia);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("click in normal mode calls onClick, not onToggleSelect", () => {
    const onClick = vi.fn();
    const onToggleSelect = vi.fn();
    render(
      <PhotoCard
        media={mockMedia}
        onClick={onClick}
        onToggleSelect={onToggleSelect}
      />,
    );
    fireEvent.click(screen.getByTestId("photo-card"));
    expect(onClick).toHaveBeenCalledWith(mockMedia);
    expect(onToggleSelect).not.toHaveBeenCalled();
  });
});
