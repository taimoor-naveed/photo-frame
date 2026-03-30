import { useCallback, useEffect, useRef, useState } from "react";
import type { Media } from "../api/client";
import { api, modalVideoUrl, originalUrl, thumbnailUrl } from "../api/client";
import ConfirmDialog from "./ConfirmDialog";
import CropEditor from "./CropEditor";

interface MediaDetailModalProps {
  media: Media | null;
  onClose: () => void;
  onDelete: (id: number) => void;
  error?: string | null;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
}

const DISPLAY_ASPECT = 1024 / 600;

/**
 * Shows the full image with a bright "hole" where the crop is, dimmed everywhere else.
 * The image inside and outside the crop rect is the same scale — the rect is just a window.
 */
function CropPreviewOverlay({
  src,
  media,
}: {
  src: string;
  media: Media;
}) {
  const [imgSize, setImgSize] = useState<{ w: number; h: number } | null>(null);

  const handleImgLoad = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    setImgSize({ w: img.clientWidth, h: img.clientHeight });
  }, []);

  // Compute crop rect position on the rendered image
  const cropX = media.crop_x ?? 0.5;
  const cropY = media.crop_y ?? 0.5;
  const cropScale = media.crop_scale ?? 1;
  const imageAspect = media.width / media.height;

  // Visible fraction of the image in each axis at this crop_scale
  let visFracX: number, visFracY: number;
  if (imageAspect > DISPLAY_ASPECT) {
    visFracX = DISPLAY_ASPECT / imageAspect / cropScale;
    visFracY = 1.0 / cropScale;
  } else {
    visFracX = 1.0 / cropScale;
    visFracY = imageAspect / DISPLAY_ASPECT / cropScale;
  }

  // Rect position as fractions of image dimensions
  const rectLeft = Math.max(0, cropX - visFracX / 2);
  const rectTop = Math.max(0, cropY - visFracY / 2);
  const rectW = Math.min(1, visFracX);
  const rectH = Math.min(1, visFracY);

  return (
    <div className="relative inline-flex items-center justify-center">
      {/* Full image (bright) */}
      <img
        src={src}
        alt={media.original_name}
        data-media-id={media.id}
        className="max-w-full max-h-[70vh] object-contain"
        onLoad={handleImgLoad}
      />
      {/* Dimmed overlay with a "hole" via box-shadow */}
      {imgSize && (
        <div
          data-testid="crop-rect"
          className="absolute pointer-events-none"
          style={{
            left: `${rectLeft * imgSize.w}px`,
            top: `${rectTop * imgSize.h}px`,
            width: `${rectW * imgSize.w}px`,
            height: `${rectH * imgSize.h}px`,
            boxShadow: "0 0 0 9999px rgba(0, 0, 0, 0.6)",
            border: "1px solid rgba(255, 255, 255, 0.5)",
          }}
        />
      )}
    </div>
  );
}

export default function MediaDetailModal({
  media,
  onClose,
  onDelete,
  error,
}: MediaDetailModalProps) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [jumping, setJumping] = useState(false);
  const [jumpError, setJumpError] = useState<string | null>(null);
  const [cropEditing, setCropEditing] = useState(false);
  const [cropError, setCropError] = useState<string | null>(null);
  const [cropSaving, setCropSaving] = useState(false);
  const [cropRemoving, setCropRemoving] = useState(false);
  const cropSaveRef = useRef<(() => void) | null>(null);

  // Reset image loaded state and crop state when media changes
  useEffect(() => {
    setImageLoaded(false);
    setJumpError(null);
    setCropEditing(false);
    setCropError(null);
    setCropRemoving(false);
  }, [media?.id]);

  // Body scroll lock
  useEffect(() => {
    if (!media) return;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, [media]);

  // Escape key: exit crop editing first, then close modal
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    if (!media) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !confirmOpen) {
        if (cropEditing) {
          setCropEditing(false);
        } else {
          onCloseRef.current();
        }
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [media, confirmOpen, cropEditing]);

  if (!media) return null;

  const isReady = media.processing_status === "ready";

  const handleSaveCrop = async (crop: { crop_x: number; crop_y: number; crop_scale: number }) => {
    if (!media) return;
    setCropSaving(true);
    setCropError(null);
    try {
      await api.media.setCrop(media.id, crop);
      setCropEditing(false);
    } catch {
      setCropError("Failed to save crop");
    } finally {
      setCropSaving(false);
    }
  };

  const handleRemoveCrop = async () => {
    if (!media) return;
    setCropError(null);
    setCropRemoving(true);
    try {
      await api.media.removeCrop(media.id);
    } catch {
      setCropError("Failed to remove crop");
    } finally {
      setCropRemoving(false);
    }
  };
  const jumpTitle = media.processing_status === "processing"
    ? "Not available while processing"
    : media.processing_status === "error"
      ? "Not available for failed media"
      : undefined;

  return (
    <>
      {/* Backdrop */}
      <div
        data-testid="media-detail-modal"
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
        onClick={() => { if (!cropEditing) onClose(); }}
      >
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm" />

        {/* Modal card */}
        <div
          className={`relative z-10 w-full max-w-4xl max-h-[90vh] rounded-2xl bg-surface shadow-gallery-xl border border-white/[0.06] overflow-hidden flex flex-col ${cropEditing ? "h-[90vh]" : ""}`}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header bar */}
          <div className="flex items-center justify-between px-5 py-3 border-b border-white/[0.06]">
            <h2 className="text-sm font-medium text-warm-white truncate mr-4">
              {media.original_name}
            </h2>
            <div className="flex items-center gap-1 shrink-0">
              <button
                onClick={async (e) => {
                  const btn = e.currentTarget;
                  if (!media || jumping || !isReady) return;
                  setJumping(true);
                  setJumpError(null);
                  try {
                    await api.slideshow.jump(media.id);
                  } catch {
                    setJumpError("Failed to jump slideshow");
                  } finally {
                    setJumping(false);
                    btn.blur();
                  }
                }}
                disabled={jumping || !isReady}
                title={jumpTitle}
                className="rounded-lg p-2 text-warm-gray hover:text-warm-white hover:bg-white/[0.06] transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none"
                aria-label="Show in slideshow"
              >
                <svg
                  className="h-5 w-5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"
                  />
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
              </button>
              <a
                href={originalUrl(media)}
                download={media.original_name}
                className="rounded-lg p-2 text-warm-gray hover:text-warm-white hover:bg-white/[0.06] transition-colors"
                aria-label="Download"
                onClick={(e) => e.stopPropagation()}
              >
                <svg
                  className="h-5 w-5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                  />
                </svg>
              </a>
              <button
                onClick={() => setConfirmOpen(true)}
                className="rounded-lg p-2 text-warm-gray hover:text-red-400 hover:bg-red-500/10 transition-colors"
                aria-label="Delete"
              >
                <svg
                  className="h-5 w-5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                  />
                </svg>
              </button>
              <button
                onClick={onClose}
                className="rounded-lg p-2 text-warm-gray hover:text-warm-white hover:bg-white/[0.06] transition-colors"
                aria-label="Close"
              >
                <svg
                  className="h-5 w-5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>
          </div>

          {/* Error banners */}
          {error && (
            <div className="px-5 py-2 bg-red-500/10 border-b border-red-500/20">
              <p className="text-sm font-medium text-red-400">Error: {error}</p>
            </div>
          )}
          {jumpError && (
            <div className="px-5 py-2 bg-red-500/10 border-b border-red-500/20">
              <p className="text-sm font-medium text-red-400">Error: {jumpError}</p>
            </div>
          )}
          {cropError && (
            <div className="px-5 py-2 bg-red-500/10 border-b border-red-500/20">
              <p className="text-sm font-medium text-red-400">Error: {cropError}</p>
            </div>
          )}

          {/* Media area */}
          {cropEditing ? (
            <div className="flex-1 min-h-0 bg-black flex flex-col">
              <CropEditor
                src={originalUrl(media)}
                imageWidth={media.width}
                imageHeight={media.height}
                initialCrop={
                  media.crop_scale != null && media.crop_x != null && media.crop_y != null
                    ? { crop_x: media.crop_x, crop_y: media.crop_y, crop_scale: media.crop_scale }
                    : null
                }
                saving={cropSaving}
                saveRef={cropSaveRef}
                onSave={handleSaveCrop}
                onCancel={() => setCropEditing(false)}
              />
            </div>
          ) : (
            <div className="flex-1 min-h-0 bg-black flex items-center justify-center overflow-hidden">
              {media.processing_status === "processing" ? (
                <div className="relative flex items-center justify-center">
                  <img
                    src={thumbnailUrl(media)}
                    alt={media.original_name}
                    className="max-w-full max-h-[70vh] object-contain opacity-40"
                  />
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <svg className="h-16 w-16 -rotate-90" viewBox="0 0 48 48">
                      <circle
                        cx="24" cy="24" r="20"
                        fill="none"
                        stroke="rgba(255,255,255,0.2)"
                        strokeWidth="3"
                      />
                      <circle
                        cx="24" cy="24" r="20"
                        fill="none"
                        stroke="#D4956A"
                        strokeWidth="3"
                        strokeLinecap="round"
                        strokeDasharray={2 * Math.PI * 20}
                        strokeDashoffset={
                          2 * Math.PI * 20 * (1 - (media.processing_progress ?? 0) / 100)
                        }
                        className="transition-[stroke-dashoffset] duration-500 ease-out"
                      />
                    </svg>
                    <span className="text-sm font-medium text-warm-white drop-shadow-md mt-2">
                      {media.processing_progress != null && media.processing_progress > 0
                        ? `${media.processing_progress}%`
                        : "Processing..."}
                    </span>
                  </div>
                </div>
              ) : media.processing_status === "error" ? (
                <div className="relative flex items-center justify-center">
                  <img
                    src={thumbnailUrl(media)}
                    alt={media.original_name}
                    className="max-w-full max-h-[70vh] object-contain opacity-60"
                  />
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <svg className="h-10 w-10 text-red-400 mb-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <span className="text-sm font-medium text-red-300">Failed</span>
                  </div>
                </div>
              ) : media.media_type === "video" ? (
                <video
                  src={modalVideoUrl(media)}
                  data-media-id={media.id}
                  className="max-w-full max-h-[70vh] object-contain"
                  autoPlay
                  muted
                  controls
                />
              ) : (
                <div data-testid="crop-overlay" className="relative flex items-center justify-center w-full h-full">
                  {media.crop_scale != null ? (
                    <CropPreviewOverlay src={originalUrl(media)} media={media} />
                  ) : (
                    <>
                      {!imageLoaded && (
                        <img
                          src={thumbnailUrl(media)}
                          alt=""
                          className="max-w-full max-h-[70vh] object-contain blur-sm"
                        />
                      )}
                      <img
                        src={originalUrl(media)}
                        alt={media.original_name}
                        data-media-id={media.id}
                        className={`max-w-full max-h-[70vh] object-contain ${
                          !imageLoaded ? "absolute inset-0 m-auto opacity-0" : ""
                        }`}
                        onLoad={() => setImageLoaded(true)}
                      />
                    </>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Crop action bar — below image, above metadata */}
          {media.media_type === "photo" && isReady && (
            <div className="flex items-center justify-center gap-2 px-5 py-2 border-t border-white/[0.06]">
              {cropEditing ? (
                <>
                  <button
                    onClick={() => setCropEditing(false)}
                    className="px-4 py-1.5 min-h-[44px] rounded-lg bg-white/[0.12] border border-white/[0.1] text-warm-white hover:bg-white/[0.18] transition-colors text-sm"
                    aria-label="Cancel"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => cropSaveRef.current?.()}
                    disabled={cropSaving}
                    className="px-4 py-1.5 min-h-[44px] rounded-lg bg-white/[0.12] border border-white/[0.1] text-warm-white hover:bg-white/[0.18] transition-colors text-sm disabled:opacity-50"
                    aria-label="Save crop"
                  >
                    {cropSaving ? "Saving..." : "Save Crop"}
                  </button>
                </>
              ) : media.crop_scale != null ? (
                <>
                  <button
                    onClick={() => setCropEditing(true)}
                    className="px-4 py-1.5 min-h-[44px] rounded-lg bg-white/[0.12] border border-white/[0.1] text-warm-white hover:bg-white/[0.18] transition-colors text-sm"
                    aria-label="Edit crop"
                  >
                    Edit Crop
                  </button>
                  <button
                    onClick={handleRemoveCrop}
                    disabled={cropRemoving}
                    className="px-4 py-1.5 min-h-[44px] rounded-lg text-red-400/80 hover:text-red-400 hover:bg-red-500/10 transition-colors text-sm disabled:opacity-50"
                    aria-label="Remove crop"
                  >
                    {cropRemoving ? "Clearing..." : "Clear Crop"}
                  </button>
                </>
              ) : (
                <button
                  onClick={() => setCropEditing(true)}
                  className="px-4 py-1.5 min-h-[44px] rounded-lg bg-white/[0.12] border border-white/[0.1] text-warm-white hover:bg-white/[0.18] transition-colors text-sm"
                  aria-label="Add crop"
                >
                  Set Crop
                </button>
              )}
            </div>
          )}

          {/* Metadata bar */}
          <div className="flex items-center gap-4 px-5 py-3 border-t border-white/[0.06] text-xs text-warm-gray">
            <span>
              {media.width} &times; {media.height}
            </span>
            <span>{formatFileSize(media.file_size)}</span>
            {media.media_type === "video" && media.duration != null && (
              <span>{formatDuration(media.duration)}</span>
            )}
            <span className="ml-auto">{formatDate(media.uploaded_at)}</span>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title="Delete media"
        message={`Are you sure you want to delete "${media.original_name}"? This cannot be undone.`}
        onConfirm={() => {
          setConfirmOpen(false);
          onDelete(media.id);
        }}
        onCancel={() => setConfirmOpen(false)}
      />
    </>
  );
}
