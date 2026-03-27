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
    // Wide image: height is the limiting dimension, fits at scale 1
    return 1.0;
  }
  // Tall image: need to zoom so width fills the crop rect
  return DISPLAY_ASPECT / imageAspect;
}

function clampPosition(
  cropX: number,
  cropY: number,
  scale: number,
  imageWidth: number,
  imageHeight: number,
): { cropX: number; cropY: number } {
  // When using object-fit: cover with object-position and scale:
  // The visible fraction of the image in each axis depends on the relationship
  // between image aspect and display aspect, plus the scale.
  //
  // With object-fit: cover at scale=1:
  // - If image is wider than display: full height visible, partial width
  //   visible width fraction = displayAspect / imageAspect
  // - If image is taller than display: full width visible, partial height
  //   visible height fraction = imageAspect / displayAspect
  //
  // At higher scales, the visible fraction shrinks by 1/scale.

  const imageAspect = imageWidth / imageHeight;

  let visibleFractionX: number;
  let visibleFractionY: number;

  if (imageAspect > DISPLAY_ASPECT) {
    // Wide image: at scale 1, height fills, width is cropped
    visibleFractionX = DISPLAY_ASPECT / imageAspect / scale;
    visibleFractionY = 1.0 / scale;
  } else {
    // Tall image: at scale 1, width fills, height is cropped
    visibleFractionX = 1.0 / scale;
    visibleFractionY = imageAspect / DISPLAY_ASPECT / scale;
  }

  // The crop center must be far enough from edges that the visible rectangle
  // doesn't extend outside the image (0..1 range)
  const halfX = visibleFractionX / 2;
  const halfY = visibleFractionY / 2;

  const minX = halfX;
  const maxX = 1 - halfX;
  const minY = halfY;
  const maxY = 1 - halfY;

  return {
    cropX: Math.max(minX, Math.min(maxX, cropX)),
    cropY: Math.max(minY, Math.min(maxY, cropY)),
  };
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
  const maxScale = Math.max(minScale * 3, 4);

  // Initialize state from initialCrop or defaults
  const initScale = initialCrop
    ? Math.max(initialCrop.crop_scale, minScale)
    : minScale;

  const initPos = initialCrop
    ? clampPosition(initialCrop.crop_x, initialCrop.crop_y, initScale, imageWidth, imageHeight)
    : { cropX: 0.5, cropY: 0.5 };

  const [cropX, setCropX] = useState(initPos.cropX);
  const [cropY, setCropY] = useState(initPos.cropY);
  const [scale, setScale] = useState(initScale);

  // Drag state
  const dragging = useRef(false);
  const lastPointer = useRef({ x: 0, y: 0 });
  const cropAreaRef = useRef<HTMLDivElement>(null);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    dragging.current = true;
    lastPointer.current = { x: e.clientX, y: e.clientY };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragging.current || !cropAreaRef.current) return;

      const dx = e.clientX - lastPointer.current.x;
      const dy = e.clientY - lastPointer.current.y;
      lastPointer.current = { x: e.clientX, y: e.clientY };

      // The crop area dimensions on screen
      const rect = cropAreaRef.current.getBoundingClientRect();
      const cropW = rect.width;
      const cropH = rect.height;

      // Convert pixel drag to fraction of image.
      // The crop area shows a portion of the image. Moving pointer right
      // should shift the crop region right on the image, meaning cropX increases.
      // But visually we want the image to move opposite to the drag (like panning a map),
      // so dragging right = image moves left = crop region moves right = cropX increases.
      // Wait — actually dragging right should feel like grabbing the image and moving it,
      // so the image moves right, meaning we see a region further LEFT on the image.
      // So: drag right → cropX decreases.

      const imageAspect = imageWidth / imageHeight;

      // How many image-fraction units does one pixel of drag represent?
      // The crop area shows visibleFractionX of the image width.
      // So cropW pixels = visibleFractionX of the image.
      let visibleFractionX: number;
      let visibleFractionY: number;
      if (imageAspect > DISPLAY_ASPECT) {
        visibleFractionX = DISPLAY_ASPECT / imageAspect / scale;
        visibleFractionY = 1.0 / scale;
      } else {
        visibleFractionX = 1.0 / scale;
        visibleFractionY = imageAspect / DISPLAY_ASPECT / scale;
      }

      const dCropX = -(dx / cropW) * visibleFractionX;
      const dCropY = -(dy / cropH) * visibleFractionY;

      setCropX((prev) => {
        const next = prev + dCropX;
        return clampPosition(next, 0.5, scale, imageWidth, imageHeight).cropX;
      });
      setCropY((prev) => {
        const next = prev + dCropY;
        return clampPosition(0.5, next, scale, imageWidth, imageHeight).cropY;
      });
    },
    [scale, imageWidth, imageHeight],
  );

  const handlePointerUp = useCallback(() => {
    dragging.current = false;
  }, []);

  const handleSliderChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const newScale = Math.max(parseFloat(e.target.value), minScale);
      setScale(newScale);
      // Re-clamp position for new scale
      setCropX((prev) =>
        clampPosition(prev, 0.5, newScale, imageWidth, imageHeight).cropX,
      );
      setCropY((prev) =>
        clampPosition(0.5, prev, newScale, imageWidth, imageHeight).cropY,
      );
    },
    [minScale, imageWidth, imageHeight],
  );

  const handleSave = useCallback(() => {
    onSave({ crop_x: cropX, crop_y: cropY, crop_scale: scale });
  }, [onSave, cropX, cropY, scale]);

  return (
    <div className="flex flex-col items-center gap-4 w-full">
      {/* Crop area with dimmed background */}
      <div className="relative w-full max-w-[640px]" style={{ aspectRatio: "1024 / 600" }}>
        {/* Dimmed full image behind for spatial context */}
        <img
          src={src}
          alt=""
          aria-hidden="true"
          draggable={false}
          className="absolute inset-0 w-full h-full object-contain brightness-[0.3] select-none pointer-events-none"
          data-testid="crop-dimmed-bg"
        />

        {/* Crop viewport */}
        <div
          ref={cropAreaRef}
          className="absolute inset-0 overflow-hidden cursor-grab active:cursor-grabbing border-2 border-white/60"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
        >
          {/* Cropped image preview */}
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

      {/* Zoom slider */}
      <div className="flex items-center gap-3 w-full max-w-[640px] px-2">
        <span className="text-warm-gray text-sm">Zoom</span>
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
      </div>

      {/* Action buttons */}
      <div className="flex gap-3">
        <button
          type="button"
          onClick={onCancel}
          className="px-5 py-2.5 min-h-[44px] rounded-lg bg-white/[0.06] border border-white/[0.06] text-warm-white hover:bg-white/10 backdrop-blur transition-colors"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="px-5 py-2.5 min-h-[44px] rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {saving ? "Saving..." : "Save Crop"}
        </button>
      </div>
    </div>
  );
}
