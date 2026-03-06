import { useCallback, useRef } from "react";
import type { Media } from "../api/client";
import { thumbnailUrl } from "../api/client";

interface PhotoCardProps {
  media: Media;
  onClick?: (media: Media) => void;
  selectionMode?: boolean;
  selected?: boolean;
  onLongPress?: (media: Media) => void;
  onToggleSelect?: (media: Media) => void;
}

const LONG_PRESS_MS = 500;

export default function PhotoCard({
  media,
  onClick,
  selectionMode = false,
  selected = false,
  onLongPress,
  onToggleSelect,
}: PhotoCardProps) {
  const isProcessing = media.processing_status === "processing";
  const isError = media.processing_status === "error";
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const didLongPress = useRef(false);

  const clearTimer = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }, []);

  const handlePointerDown = useCallback(() => {
    didLongPress.current = false;
    longPressTimer.current = setTimeout(() => {
      didLongPress.current = true;
      longPressTimer.current = null;
      onLongPress?.(media);
    }, LONG_PRESS_MS);
  }, [media, onLongPress]);

  const handlePointerUp = useCallback(() => {
    clearTimer();
  }, [clearTimer]);

  const handleClick = useCallback(() => {
    if (didLongPress.current) {
      didLongPress.current = false;
      return;
    }
    if (isProcessing || isError) return;

    if (selectionMode) {
      onToggleSelect?.(media);
    } else {
      onClick?.(media);
    }
  }, [isProcessing, isError, selectionMode, media, onClick, onToggleSelect]);

  return (
    <div
      data-testid="photo-card"
      data-media-id={media.id}
      className={`group relative overflow-hidden rounded-2xl bg-surface shadow-gallery transition-all duration-300 ${
        !isProcessing && !isError ? "cursor-pointer" : ""
      } ${selected ? "ring-2 ring-copper ring-offset-2 ring-offset-ink" : "hover:shadow-gallery-hover hover:scale-[1.02] hover:-translate-y-1"}`}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
      onClick={handleClick}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="aspect-[4/3]">
        <img
          src={thumbnailUrl(media)}
          alt={media.original_name}
          className={`h-full w-full object-cover transition-opacity ${
            isProcessing ? "opacity-40" : isError ? "opacity-60" : ""
          }`}
          loading="lazy"
          draggable={false}
        />
      </div>

      {/* Processing overlay — pie progress */}
      {isProcessing && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/40">
          <svg className="h-12 w-12 -rotate-90" viewBox="0 0 48 48">
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
          <span className="text-xs font-medium text-warm-white drop-shadow-md mt-1.5">
            {media.processing_progress != null && media.processing_progress > 0
              ? `${media.processing_progress}%`
              : "Processing..."}
          </span>
        </div>
      )}

      {/* Error overlay */}
      {isError && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-red-900/30">
          <svg className="h-8 w-8 text-red-400 mb-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span className="text-xs font-medium text-red-300">Failed</span>
        </div>
      )}

      {/* Media type badge */}
      {media.media_type === "video" && (
        <div className="absolute top-2.5 left-2.5 rounded-lg bg-black/60 backdrop-blur-sm px-2 py-1 text-xs font-medium text-warm-white">
          Video
        </div>
      )}

      {/* Selection indicator */}
      {selectionMode && (
        <div
          data-testid="selection-indicator"
          className="absolute top-2.5 right-2.5"
        >
          {selected ? (
            <div data-testid="selection-checked" className="flex h-6 w-6 items-center justify-center rounded-full bg-copper shadow-sm">
              <svg className="h-3.5 w-3.5 text-ink" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
          ) : (
            <div data-testid="selection-unchecked" className="h-6 w-6 rounded-full border-2 border-white/60 bg-black/30 shadow-sm" />
          )}
        </div>
      )}
    </div>
  );
}
