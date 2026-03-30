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
  saveRef?: React.MutableRefObject<(() => void) | null>;
  onSave: (crop: CropData) => void;
  onCancel: () => void;
}

/**
 * iOS-style crop editor.
 *
 * Layout: full image fills the screen, a fixed crop rectangle (1024:600) is overlaid
 * in the center. Area outside the rectangle is dimmed. User drags/pinches the image
 * behind the fixed rectangle.
 *
 * Internal state: image transform as (translateX, translateY, zoom) in pixels.
 * On save, converts to (crop_x, crop_y, crop_scale) — fractions of image dimensions.
 */
export default function CropEditor({
  src,
  imageWidth,
  imageHeight,
  initialCrop,
  saving = false,
  saveRef,
  onSave,
  onCancel,
}: CropEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);

  // ─── Geometry: compute the image's rendered size and crop rect ──────
  // We need these to convert between pixel transforms and crop fractions.
  // They're computed on first render and updated on layout changes.
  const getLayout = useCallback(() => {
    const container = containerRef.current;
    const img = imageRef.current;
    if (!container || !img) return null;

    const cW = container.clientWidth;
    const cH = container.clientHeight;

    // Image rendered size (object-fit: contain equivalent)
    const imgAspect = imageWidth / imageHeight;
    let imgW: number, imgH: number;
    if (imgAspect > cW / cH) {
      imgW = cW;
      imgH = cW / imgAspect;
    } else {
      imgH = cH;
      imgW = cH * imgAspect;
    }

    // Crop rectangle: centered, fits inside container, 1024:600 aspect
    let cropW: number, cropH: number;
    if (DISPLAY_ASPECT > cW / cH) {
      cropW = cW;
      cropH = cW / DISPLAY_ASPECT;
    } else {
      cropH = cH;
      cropW = cH * DISPLAY_ASPECT;
    }

    return { cW, cH, imgW, imgH, cropW, cropH };
  }, [imageWidth, imageHeight]);

  // ─── Compute initial transform from crop data ──────────────────────
  const initialTransform = useMemo(() => {
    if (!initialCrop) return { tx: 0, ty: 0, zoom: 1 };

    // We need layout to convert. Can't use refs in useMemo, so approximate:
    // The zoom relative to "image fits crop rect" baseline.
    // At zoom=1 the image is at its natural rendered size.
    // crop_scale=minScale means the image just fills the crop rect.
    const imgAspect = imageWidth / imageHeight;
    const minScale = imgAspect > DISPLAY_ASPECT ? 1.0 : DISPLAY_ASPECT / imgAspect;
    const zoom = initialCrop.crop_scale / minScale;

    // Position: crop_x/crop_y are the center of the crop rect on the image (0-1).
    // At tx=0,ty=0 the image is centered, so crop center = image center (0.5, 0.5).
    // We need to shift the image so that crop_x,crop_y aligns with the crop rect center.
    // tx = (0.5 - crop_x) * imgW * zoom, ty = (0.5 - crop_y) * imgH * zoom
    // But we don't know imgW/imgH yet (no layout). Use normalized values, convert in effect.
    return {
      tx: 0, ty: 0, zoom,
      pendingCrop: initialCrop,
    };
  }, [initialCrop, imageWidth, imageHeight]);

  const [tx, setTx] = useState(initialTransform.tx);
  const [ty, setTy] = useState(initialTransform.ty);
  const [zoom, setZoom] = useState(initialTransform.zoom);
  const [initialized, setInitialized] = useState(false);

  // Refs for fresh values in pointer handlers
  const stateRef = useRef({ tx, ty, zoom });
  stateRef.current = { tx, ty, zoom };

  // ─── Initialize zoom/position once layout is available ─────────────
  const handleImageLoad = useCallback(() => {
    if (initialized) return;
    const layout = getLayout();
    if (!layout) return;

    const { imgW, imgH, cropW, cropH } = layout;
    // minZoom: pixel-based zoom where image just covers the crop rect
    const minZoom = Math.max(cropW / imgW, cropH / imgH);

    if (initialCrop) {
      // Restore saved crop position
      const z = initialCrop.crop_scale * minZoom;
      const newTx = (0.5 - initialCrop.crop_x) * imgW * z;
      const newTy = (0.5 - initialCrop.crop_y) * imgH * z;
      setTx(newTx);
      setTy(newTy);
      setZoom(z);
      stateRef.current = { tx: newTx, ty: newTy, zoom: z };
    } else {
      // Fresh crop: start at minZoom so image covers crop rect (no jump on first interaction)
      setZoom(minZoom);
      stateRef.current = { tx: 0, ty: 0, zoom: minZoom };
    }
    setInitialized(true);
  }, [initialized, initialCrop, getLayout]);

  // ─── Clamp: ensure image covers the crop rectangle ─────────────────
  const clamp = useCallback(
    (newTx: number, newTy: number, newZoom: number) => {
      const layout = getLayout();
      if (!layout) return { tx: newTx, ty: newTy, zoom: newZoom };

      const { imgW, imgH, cropW, cropH } = layout;
      const scaledW = imgW * newZoom;
      const scaledH = imgH * newZoom;

      // Min zoom: image must cover the crop rect
      const minZoomW = cropW / imgW;
      const minZoomH = cropH / imgH;
      const minZoom = Math.max(minZoomW, minZoomH);
      const z = Math.max(minZoom, Math.min(10, newZoom));

      const sw = imgW * z;
      const sh = imgH * z;

      // Max translation: the image edge must not enter the crop rect
      const maxTx = (sw - cropW) / 2;
      const maxTy = (sh - cropH) / 2;

      return {
        tx: Math.max(-maxTx, Math.min(maxTx, newTx)),
        ty: Math.max(-maxTy, Math.min(maxTy, newTy)),
        zoom: z,
      };
    },
    [getLayout],
  );

  // ─── Multi-pointer tracking ────────────────────────────────────────
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinchStartDist = useRef(0);
  const pinchStartZoom = useRef(1);
  const lastMid = useRef({ x: 0, y: 0 });

  const applyState = useCallback(
    (newTx: number, newTy: number, newZoom: number) => {
      const c = clamp(newTx, newTy, newZoom);
      setTx(c.tx);
      setTy(c.ty);
      setZoom(c.zoom);
      stateRef.current = c;
    },
    [clamp],
  );

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    const el = containerRef.current;
    if (!el) return;
    el.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinchStartDist.current = Math.hypot(b.x - a.x, b.y - a.y);
      pinchStartZoom.current = stateRef.current.zoom;
      lastMid.current = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    }
  }, []);

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!pointers.current.has(e.pointerId)) return;
      const prev = pointers.current.get(e.pointerId)!;
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

      const s = stateRef.current;

      if (pointers.current.size === 1) {
        applyState(s.tx + e.clientX - prev.x, s.ty + e.clientY - prev.y, s.zoom);
      } else if (pointers.current.size === 2) {
        const [a, b] = [...pointers.current.values()];
        const dist = Math.hypot(b.x - a.x, b.y - a.y);
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };

        const newZoom = pinchStartDist.current > 0
          ? pinchStartZoom.current * (dist / pinchStartDist.current)
          : s.zoom;

        const dx = mid.x - lastMid.current.x;
        const dy = mid.y - lastMid.current.y;
        lastMid.current = mid;

        applyState(s.tx + dx, s.ty + dy, newZoom);
      }
    },
    [applyState],
  );

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    pinchStartDist.current = 0;
  }, []);

  const onWheel = useCallback(
    (e: React.WheelEvent) => {
      e.stopPropagation();
      const s = stateRef.current;
      const delta = -e.deltaY * 0.005;
      applyState(s.tx, s.ty, s.zoom * (1 + delta));
    },
    [applyState],
  );

  // ─── Save: convert pixel transform → crop fractions ────────────────
  // Expose save function to parent via ref
  const handleSave = useCallback(() => {
    const layout = getLayout();
    if (!layout) return;

    const { imgW, imgH, cropW, cropH } = layout;
    const s = stateRef.current;

    // Image center is at container center + (tx, ty).
    // Crop rect center is at container center (0, 0 relative).
    // So crop center on image = image center - tx/ty, in image-fraction coords:
    const cropCenterX = 0.5 - s.tx / (imgW * s.zoom);
    const cropCenterY = 0.5 - s.ty / (imgH * s.zoom);

    // crop_scale: zoom relative to "image just covers crop rect" baseline
    const minZoom = Math.max(cropW / imgW, cropH / imgH);
    const cropScale = s.zoom / minZoom;

    onSave({
      crop_x: Math.max(0, Math.min(1, cropCenterX)),
      crop_y: Math.max(0, Math.min(1, cropCenterY)),
      crop_scale: Math.max(1, cropScale),
    });
  }, [getLayout, onSave]);

  // Expose save to parent via ref (so parent's bar can trigger save)
  if (saveRef) saveRef.current = handleSave;

  // ─── Render ────────────────────────────────────────────────────────
  return (
    <div className="h-full w-full">
      {/* Image + overlay area — fills entire editor space, controls are in the parent */}
      <div
        ref={containerRef}
        className="relative w-full h-full bg-black overflow-hidden"
        style={{ touchAction: "none" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={onWheel}
      >
        {/* Draggable/zoomable image */}
        <img
          ref={imageRef}
          src={src}
          alt="Crop preview"
          draggable={false}
          onLoad={handleImageLoad}
          className="absolute select-none pointer-events-none"
          style={{
            /* Center the image, then apply user transform */
            left: "50%",
            top: "50%",
            width: "100%",
            height: "100%",
            objectFit: "contain",
            transform: `translate(-50%, -50%) translate(${tx}px, ${ty}px) scale(${zoom})`,
            transformOrigin: "center center",
          }}
        />

        {/* Dimmed overlay with crop rectangle "hole" using box-shadow */}
        <div
          className="absolute pointer-events-none"
          style={{
            left: "50%",
            top: "50%",
            transform: "translate(-50%, -50%)",
            /* Size = crop rectangle. Constrained to container with aspect ratio. */
            width: "100%",
            maxHeight: "100%",
            aspectRatio: "1024 / 600",
            /* Giant box-shadow creates the dimmed area outside */
            boxShadow: "0 0 0 9999px rgba(0, 0, 0, 0.55)",
            border: "1px solid rgba(255, 255, 255, 0.5)",
          }}
        >
          {/* Rule of thirds grid lines */}
          <div className="absolute inset-0">
            <div className="absolute left-1/3 top-0 bottom-0 w-px bg-white/20" />
            <div className="absolute left-2/3 top-0 bottom-0 w-px bg-white/20" />
            <div className="absolute top-1/3 left-0 right-0 h-px bg-white/20" />
            <div className="absolute top-2/3 left-0 right-0 h-px bg-white/20" />
          </div>
        </div>
      </div>
    </div>
  );
}
