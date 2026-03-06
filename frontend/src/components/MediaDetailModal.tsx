import { useEffect, useState } from "react";
import type { Media } from "../api/client";
import { api, originalUrl, thumbnailUrl } from "../api/client";
import ConfirmDialog from "./ConfirmDialog";

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

  // Reset image loaded state when media changes
  useEffect(() => {
    setImageLoaded(false);
    setJumpError(null);
  }, [media?.id]);

  // Body scroll lock
  useEffect(() => {
    if (!media) return;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, [media]);

  // Escape key closes modal (but not when ConfirmDialog is open)
  useEffect(() => {
    if (!media) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !confirmOpen) {
        onClose();
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [media, confirmOpen, onClose]);

  if (!media) return null;

  const isReady = media.processing_status === "ready";
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
        onClick={onClose}
      >
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm" />

        {/* Modal card */}
        <div
          className="relative z-10 w-full max-w-4xl max-h-[90vh] rounded-2xl bg-surface shadow-gallery-xl border border-white/[0.06] overflow-hidden flex flex-col"
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
                className="rounded-lg p-2 text-warm-gray hover:text-warm-white hover:bg-white/[0.06] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
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

          {/* Media area */}
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
                src={originalUrl(media)}
                data-media-id={media.id}
                className="max-w-full max-h-[70vh] object-contain"
                autoPlay
                muted
                controls
              />
            ) : (
              <div className="relative flex items-center justify-center w-full h-full">
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
              </div>
            )}
          </div>

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
