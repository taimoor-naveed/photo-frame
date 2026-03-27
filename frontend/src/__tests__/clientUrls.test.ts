import { originalUrl, displayUrl, modalVideoUrl, thumbnailUrl } from "../api/client";
import type { Media } from "../api/client";

function makeMedia(overrides: Partial<Media> = {}): Media {
  return {
    id: 1,
    filename: "photo1.jpg",
    original_name: "sunset.jpg",
    media_type: "photo",
    width: 800,
    height: 600,
    file_size: 12345,
    duration: null,
    codec: null,
    thumb_filename: "thumb_photo1.jpg",
    display_filename: null,

    processing_status: "ready",
    content_hash: "hash1",
    uploaded_at: "2026-01-01T00:00:00",
    crop_x: null,
    crop_y: null,
    crop_scale: null,
    ...overrides,
  };
}

describe("displayUrl", () => {
  // ─── Failure / fallback paths first ────────────────────────

  it("falls back to originalUrl when display_filename is null (photo)", () => {
    const media = makeMedia({ display_filename: null });
    expect(displayUrl(media)).toBe("/uploads/originals/photo1.jpg");
    expect(displayUrl(media)).toBe(originalUrl(media));
  });

  it("falls back to originalUrl when display_filename is null (video)", () => {
    const media = makeMedia({
      media_type: "video",
      filename: "video1.mp4",
      display_filename: null,
    });
    expect(displayUrl(media)).toBe("/uploads/originals/video1.mp4");
  });

  // ─── Happy paths ───────────────────────────────────────────

  it("returns display URL for photo with display_filename", () => {
    const media = makeMedia({ display_filename: "display_abc.jpg" });
    expect(displayUrl(media)).toBe("/uploads/display/display_abc.jpg");
  });

  it("returns display URL for video with display_filename", () => {
    const media = makeMedia({
      media_type: "video",
      filename: "video1.mp4",
      display_filename: "display_xyz.mp4",
    });
    expect(displayUrl(media)).toBe("/uploads/display/display_xyz.mp4");
  });

  it("returns display URL for transcoded video with display_filename", () => {
    const media = makeMedia({
      media_type: "video",
      filename: "video1.mov",
      codec: "mpeg4",
      display_filename: "display_abc.mp4",
    });
    expect(displayUrl(media)).toBe("/uploads/display/display_abc.mp4");
  });
});

describe("modalVideoUrl", () => {
  // ─── Failure / fallback paths first ────────────────────────

  it("falls back to displayUrl when codec is null (unknown)", () => {
    const media = makeMedia({
      media_type: "video",
      filename: "video1.mp4",
      codec: null,
      display_filename: "display_xyz.mp4",
    });
    expect(modalVideoUrl(media)).toBe("/uploads/display/display_xyz.mp4");
  });

  it("falls back to displayUrl for non-browser-compatible codec (hevc)", () => {
    const media = makeMedia({
      media_type: "video",
      filename: "video1.mov",
      codec: "hevc",
      display_filename: "display_abc.mp4",
    });
    expect(modalVideoUrl(media)).toBe("/uploads/display/display_abc.mp4");
  });

  it("falls back to displayUrl for non-browser-compatible codec (mpeg4)", () => {
    const media = makeMedia({
      media_type: "video",
      filename: "video1.mov",
      codec: "mpeg4",
      display_filename: "display_abc.mp4",
    });
    expect(modalVideoUrl(media)).toBe("/uploads/display/display_abc.mp4");
  });

  // ─── Happy paths ───────────────────────────────────────────

  it("returns originalUrl for h264 video (browser-compatible)", () => {
    const media = makeMedia({
      media_type: "video",
      filename: "video1.mp4",
      codec: "h264",
      display_filename: "display_xyz.mp4",
    });
    expect(modalVideoUrl(media)).toBe("/uploads/originals/video1.mp4");
  });

  it("returns originalUrl for vp9 video (browser-compatible)", () => {
    const media = makeMedia({
      media_type: "video",
      filename: "video1.webm",
      codec: "vp9",
      display_filename: "display_xyz.mp4",
    });
    expect(modalVideoUrl(media)).toBe("/uploads/originals/video1.webm");
  });

  it("returns originalUrl for av1 video (browser-compatible)", () => {
    const media = makeMedia({
      media_type: "video",
      filename: "video1.webm",
      codec: "av1",
      display_filename: "display_xyz.mp4",
    });
    expect(modalVideoUrl(media)).toBe("/uploads/originals/video1.webm");
  });

  it("is case-insensitive for codec matching", () => {
    const media = makeMedia({
      media_type: "video",
      filename: "video1.mp4",
      codec: "H264",
      display_filename: "display_xyz.mp4",
    });
    expect(modalVideoUrl(media)).toBe("/uploads/originals/video1.mp4");
  });

  it("falls back to originalUrl when no display_filename and unknown codec", () => {
    const media = makeMedia({
      media_type: "video",
      filename: "video1.mp4",
      codec: "prores",
      display_filename: null,
    });
    // No display file available, so falls through to originalUrl
    expect(modalVideoUrl(media)).toBe("/uploads/originals/video1.mp4");
  });
});

describe("originalUrl", () => {
  it("returns originals path for photo", () => {
    const media = makeMedia();
    expect(originalUrl(media)).toBe("/uploads/originals/photo1.jpg");
  });

  it("returns originals path for video", () => {
    const media = makeMedia({
      media_type: "video",
      filename: "video1.mp4",
    });
    expect(originalUrl(media)).toBe("/uploads/originals/video1.mp4");
  });

  it("is NOT affected by display_filename", () => {
    const media = makeMedia({
      display_filename: "display_abc.jpg",
    });
    expect(originalUrl(media)).toBe("/uploads/originals/photo1.jpg");
  });
});

describe("thumbnailUrl", () => {
  it("returns thumbnails path", () => {
    const media = makeMedia();
    expect(thumbnailUrl(media)).toBe("/uploads/thumbnails/thumb_photo1.jpg");
  });
});
