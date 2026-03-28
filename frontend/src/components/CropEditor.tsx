import { useState, useRef, useCallback, useMemo } from "react";

const DISPLAY_ASPECT = 1024 / 600;

interface CropData {
  crop_x: number;
  crop_y: number;
  crop_scale: number;
}

interface CropEditorProps {
  src: string;
  imageWidth: number;
  imageHeight: number;
  initialCrop: CropData | null;
  saving?: boolean;
  onSave: (crop: CropData) => void;
  onCancel: () => void;
}

function computeMinScale(imageWidth: number, imageHeight: number): number {
  const imageAspect = imageWidth / imageHeight;
  if (imageAspect > DISPLAY_ASPECT) {
    return 1.0;
  }
  return DISPLAY_ASPECT / imageAspect;
}

function clampPosition(
  cropX: number,
  cropY: number,
  scale: number,
  imageWidth: number,
  imageHeight: number,
): { cropX: number; cropY: number } {
  const imageAspect = imageWidth / imageHeight;

  let visibleFractionX: number;
  let visibleFractionY: number;

  if (imageAspect > DISPLAY_ASPECT) {
    visibleFractionX = DISPLAY_ASPECT / imageAspect / scale;
    visibleFractionY = 1.0 / scale;
  } else {
    visibleFractionX = 1.0 / scale;
    visibleFractionY = imageAspect / DISPLAY_ASPECT / scale;
  }

  const halfX = visibleFractionX / 2;
  const halfY = visibleFractionY / 2;

  return {
    cropX: Math.max(halfX, Math.min(1 - halfX, cropX)),
    cropY: Math.max(halfY, Math.min(1 - halfY, cropY)),
  };
}

/** Get the midpoint between two pointer positions. */
function midpoint(a: { x: number; y: number }, b: { x: number; y: number }) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/** Get the distance between two pointer positions. */
function distance(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export default function CropEditor({
  src,
  imageWidth,
  imageHeight,
  initialCrop,
  saving = false,
  onSave,
  onCancel,
}: CropEditorProps) {
  const minScale = useMemo(
    () => computeMinScale(imageWidth, imageHeight),
    [imageWidth, imageHeight],
  );
  const maxScale = Math.max(minScale * 3, 10);

  const initScale = initialCrop
    ? Math.max(initialCrop.crop_scale, minScale)
    : minScale;

  const initPos = initialCrop
    ? clampPosition(initialCrop.crop_x, initialCrop.crop_y, initScale, imageWidth, imageHeight)
    : { cropX: 0.5, cropY: 0.5 };

  const [cropX, setCropX] = useState(initPos.cropX);
  const [cropY, setCropY] = useState(initPos.cropY);
  const [scale, setScale] = useState(initScale);

  // Refs for fresh values inside pointer handlers (avoid stale closures)
  const stateRef = useRef({ cropX, cropY, scale });
  stateRef.current = { cropX, cropY, scale };

  const cropAreaRef = useRef<HTMLDivElement>(null);

  // ─── Multi-pointer tracking ───────────────────────────────────
  // Map of pointerId → { x, y } for all active pointers on the crop area.
  // 1 pointer = pan. 2 pointers = pinch-to-zoom + pan.
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  // Snapshot of scale when pinch started, so we compute relative zoom.
  const pinchStartScale = useRef(1);
  const pinchStartDist = useRef(0);
  // Last known midpoint for 2-finger pan during pinch.
  const lastMid = useRef({ x: 0, y: 0 });

  const applyDelta = useCallback(
    (dx: number, dy: number, currentScale: number) => {
      const el = cropAreaRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();

      // Dragging right = image moves right = crop center moves left.
      const dCropX = -(dx / rect.width) / currentScale;
      const dCropY = -(dy / rect.height) / currentScale;

      const s = stateRef.current;
      const clamped = clampPosition(s.cropX + dCropX, s.cropY + dCropY, currentScale, imageWidth, imageHeight);
      setCropX(clamped.cropX);
      setCropY(clamped.cropY);
      stateRef.current.cropX = clamped.cropX;
      stateRef.current.cropY = clamped.cropY;
    },
    [imageWidth, imageHeight],
  );

  const applyScale = useCallback(
    (newScale: number) => {
      const clamped = Math.max(minScale, Math.min(maxScale, newScale));
      setScale(clamped);
      stateRef.current.scale = clamped;
      const s = stateRef.current;
      const pos = clampPosition(s.cropX, s.cropY, clamped, imageWidth, imageHeight);
      setCropX(pos.cropX);
      setCropY(pos.cropY);
      stateRef.current.cropX = pos.cropX;
      stateRef.current.cropY = pos.cropY;
    },
    [minScale, maxScale, imageWidth, imageHeight],
  );

  // ─── Pointer event handlers ───────────────────────────────────
  // `touch-action: none` on the element tells the browser we handle everything.
  // All input (mouse, touch, pen) comes through as pointer events.

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    const el = cropAreaRef.current;
    if (!el) return;
    el.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    // If this is the 2nd pointer, snapshot pinch state
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinchStartDist.current = distance(a, b);
      pinchStartScale.current = stateRef.current.scale;
      lastMid.current = midpoint(a, b);
    }
  }, []);

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!pointers.current.has(e.pointerId)) return;

      const prev = pointers.current.get(e.pointerId)!;
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (pointers.current.size === 1) {
        // Single pointer → pan
        const dx = e.clientX - prev.x;
        const dy = e.clientY - prev.y;
        applyDelta(dx, dy, stateRef.current.scale);
      } else if (pointers.current.size === 2) {
        // Two pointers → pinch-to-zoom + pan
        const [a, b] = [...pointers.current.values()];
        const dist = distance(a, b);
        const mid = midpoint(a, b);

        // Zoom
        if (pinchStartDist.current > 0) {
          applyScale(pinchStartScale.current * (dist / pinchStartDist.current));
        }

        // Pan (track midpoint movement)
        const dx = mid.x - lastMid.current.x;
        const dy = mid.y - lastMid.current.y;
        if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
          applyDelta(dx, dy, stateRef.current.scale);
        }
        lastMid.current = mid;
      }
    },
    [applyDelta, applyScale],
  );

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    pinchStartDist.current = 0;

    // If we still have 2 pointers after removing one (shouldn't happen normally),
    // reset pinch state. If we go from 2→1, the remaining pointer continues as pan.
  }, []);

  // ─── Mouse wheel zoom ──────────────────────────────────────────
  const onWheel = useCallback(
    (e: React.WheelEvent) => {
      e.stopPropagation();
      const delta = -e.deltaY * 0.005;
      applyScale(stateRef.current.scale * (1 + delta));
    },
    [applyScale],
  );

  const handleSliderChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      applyScale(parseFloat(e.target.value));
    },
    [applyScale],
  );

  const handleSave = useCallback(() => {
    onSave({ crop_x: cropX, crop_y: cropY, crop_scale: scale });
  }, [onSave, cropX, cropY, scale]);

  return (
    <div className="flex flex-col h-full w-full">
      {/* Crop area — fills available space */}
      <div className="flex-1 min-h-0 relative bg-black">
        {/* Dimmed full image behind for spatial context */}
        <img
          src={src}
          alt=""
          aria-hidden="true"
          draggable={false}
          className="absolute inset-0 w-full h-full object-contain brightness-[0.3] select-none pointer-events-none"
          data-testid="crop-dimmed-bg"
        />

        {/* Centered crop viewport at display aspect ratio */}
        <div className="absolute inset-0 flex items-center justify-center p-4">
          <div
            ref={cropAreaRef}
            className="relative overflow-hidden cursor-grab active:cursor-grabbing border-2 border-white/60 w-full h-full"
            style={{
              touchAction: "none",      /* KEY: tells browser we handle all gestures */
              maxWidth: "100%",
              maxHeight: "100%",
              aspectRatio: "1024 / 600",
            }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onWheel={onWheel}
          >
            <img
              src={src}
              alt="Crop preview"
              className="absolute inset-0 w-full h-full object-cover select-none pointer-events-none"
              draggable={false}
              style={{
                objectPosition: `${cropX * 100}% ${cropY * 100}%`,
                transform: `scale(${scale})`,
                transformOrigin: `${cropX * 100}% ${cropY * 100}%`,
              }}
            />
          </div>
        </div>
      </div>

      {/* Controls bar */}
      <div className="flex items-center gap-3 px-4 py-3 border-t border-white/[0.06] bg-surface">
        <span className="text-warm-gray text-sm shrink-0">−</span>
        <input
          type="range"
          role="slider"
          min={minScale}
          max={maxScale}
          step={0.01}
          value={scale}
          onChange={handleSliderChange}
          className="flex-1 h-2 accent-blue-600"
        />
        <span className="text-warm-gray text-sm shrink-0">+</span>

        <div className="flex gap-2 ml-2 shrink-0">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 min-h-[44px] rounded-lg bg-white/[0.06] border border-white/[0.06] text-warm-white hover:bg-white/10 transition-colors text-sm"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 min-h-[44px] rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm"
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
