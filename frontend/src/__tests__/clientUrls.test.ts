import { originalUrl, displayUrl, thumbnailUrl } from "../api/client";
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
    transcoded_filename: null,
    display_filename: null,
    processing_status: "ready",
    content_hash: "hash1",
    uploaded_at: "2026-01-01T00:00:00",
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

  it("falls back to originalUrl when display_filename is null (video, no transcode)", () => {
    const media = makeMedia({
      media_type: "video",
      filename: "video1.mp4",
      display_filename: null,
      transcoded_filename: null,
    });
    expect(displayUrl(media)).toBe("/uploads/originals/video1.mp4");
  });

  it("falls back to transcoded URL when display_filename is null (video, transcoded)", () => {
    const media = makeMedia({
      media_type: "video",
      filename: "video1.mp4",
      display_filename: null,
      transcoded_filename: "transcoded_abc.mp4",
    });
    expect(displayUrl(media)).toBe("/uploads/transcoded/transcoded_abc.mp4");
  });

  // ─── Happy paths ───────────────────────────────────────────

  it("returns display URL for photo with display_filename", () => {
    const media = makeMedia({ display_filename: "display_abc.jpg" });
    expect(displayUrl(media)).toBe("/uploads/display/display_abc.jpg");
  });

  it("returns display URL for video with separate display file", () => {
    const media = makeMedia({
      media_type: "video",
      filename: "video1.mp4",
      display_filename: "display_xyz.mp4",
      transcoded_filename: null,
    });
    expect(displayUrl(media)).toBe("/uploads/display/display_xyz.mp4");
  });

  it("returns transcoded URL when display_filename equals transcoded_filename (video)", () => {
    const media = makeMedia({
      media_type: "video",
      filename: "video1.mp4",
      display_filename: "transcoded_abc.mp4",
      transcoded_filename: "transcoded_abc.mp4",
    });
    // Transcoded file doubles as display file — serve from transcoded dir
    expect(displayUrl(media)).toBe("/uploads/transcoded/transcoded_abc.mp4");
  });
});

describe("originalUrl", () => {
  it("returns originals path for photo", () => {
    const media = makeMedia();
    expect(originalUrl(media)).toBe("/uploads/originals/photo1.jpg");
  });

  it("returns transcoded path for transcoded video", () => {
    const media = makeMedia({
      media_type: "video",
      filename: "video1.mp4",
      transcoded_filename: "transcoded_abc.mp4",
    });
    expect(originalUrl(media)).toBe("/uploads/transcoded/transcoded_abc.mp4");
  });

  it("returns originals path for non-transcoded video", () => {
    const media = makeMedia({
      media_type: "video",
      filename: "video1.mp4",
      transcoded_filename: null,
    });
    expect(originalUrl(media)).toBe("/uploads/originals/video1.mp4");
  });

  it("is NOT affected by display_filename (always returns original/transcoded)", () => {
    const media = makeMedia({
      display_filename: "display_abc.jpg",
    });
    // originalUrl should ignore display_filename
    expect(originalUrl(media)).toBe("/uploads/originals/photo1.jpg");
  });
});

describe("thumbnailUrl", () => {
  it("returns thumbnails path", () => {
    const media = makeMedia();
    expect(thumbnailUrl(media)).toBe("/uploads/thumbnails/thumb_photo1.jpg");
  });
});
