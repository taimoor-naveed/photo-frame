# Processing/Error Media Interaction Fixes

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Allow full user interaction (long press, selection, modal, delete) with media in any processing state — processing, error, or ready.

**Architecture:** Remove frontend guards that block interaction on non-ready media. Add processing/error overlays to the detail modal. Disable jump-to-slideshow for non-ready media (frontend + backend). Fix jump button focus state lingering after click.

**Tech Stack:** React 19, TypeScript, Vitest + RTL, Python FastAPI, pytest

---

### Task 1: PhotoCard — Allow long press on processing/error items

**Files:**
- Modify: `frontend/src/components/PhotoCard.tsx:36-44`
- Modify: `frontend/src/__tests__/PhotoCard.test.tsx:117-127`

**Step 1: Update the existing test to expect long press DOES fire on processing items**

In `frontend/src/__tests__/PhotoCard.test.tsx`, replace the test at line 117-127:

```tsx
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
```

**Step 2: Run test to verify it fails**

Run: `docker compose exec frontend npx vitest run src/__tests__/PhotoCard.test.tsx --reporter=verbose`
Expected: FAIL — `onLongPress` not called because `handlePointerDown` returns early.

**Step 3: Remove the processing/error guard from handlePointerDown**

In `frontend/src/components/PhotoCard.tsx`, change `handlePointerDown` (line 36-44):

```tsx
const handlePointerDown = useCallback(() => {
  didLongPress.current = false;
  longPressTimer.current = setTimeout(() => {
    didLongPress.current = true;
    longPressTimer.current = null;
    onLongPress?.(media);
  }, LONG_PRESS_MS);
}, [media, onLongPress]);
```

Remove `isProcessing` and `isError` from the deps array too.

**Step 4: Run test to verify it passes**

Run: `docker compose exec frontend npx vitest run src/__tests__/PhotoCard.test.tsx --reporter=verbose`
Expected: PASS

**Step 5: Commit**

```bash
git add frontend/src/components/PhotoCard.tsx frontend/src/__tests__/PhotoCard.test.tsx
git commit -m "fix: allow long press on processing/error media items"
```

---

### Task 2: PhotoCard — Allow click (modal open + selection toggle) on processing/error items

**Files:**
- Modify: `frontend/src/components/PhotoCard.tsx:50-62`
- Modify: `frontend/src/__tests__/PhotoCard.test.tsx:68-74`

**Step 1: Update tests — click should work on processing/error items**

In `frontend/src/__tests__/PhotoCard.test.tsx`, replace the test at line 68-74:

```tsx
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
```

Add a test for selection toggle on processing items:

```tsx
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
```

**Step 2: Run test to verify it fails**

Run: `docker compose exec frontend npx vitest run src/__tests__/PhotoCard.test.tsx --reporter=verbose`
Expected: FAIL — `onClick`/`onToggleSelect` not called due to early return.

**Step 3: Remove the processing/error guard from handleClick**

In `frontend/src/components/PhotoCard.tsx`, change `handleClick` (line 50-62):

```tsx
const handleClick = useCallback(() => {
  if (didLongPress.current) {
    didLongPress.current = false;
    return;
  }

  if (selectionMode) {
    onToggleSelect?.(media);
  } else {
    onClick?.(media);
  }
}, [selectionMode, media, onClick, onToggleSelect]);
```

Also remove the `isProcessing` and `isError` variables if they are no longer used anywhere in handlers (they're still used for styling, so keep the const declarations but remove from `handleClick` deps).

**Step 4: Run test to verify it passes**

Run: `docker compose exec frontend npx vitest run src/__tests__/PhotoCard.test.tsx --reporter=verbose`
Expected: PASS

**Step 5: Commit**

```bash
git add frontend/src/components/PhotoCard.tsx frontend/src/__tests__/PhotoCard.test.tsx
git commit -m "fix: allow click and selection toggle on processing/error media"
```

---

### Task 3: MediaDetailModal — Show processing overlay instead of video player

**Files:**
- Modify: `frontend/src/components/MediaDetailModal.tsx:209-240`
- Modify: `frontend/src/__tests__/MediaDetailModal.test.tsx`

**Step 1: Write failing tests**

Add to `frontend/src/__tests__/MediaDetailModal.test.tsx`:

```tsx
const mockProcessingVideo: Media = {
  ...mockVideo,
  id: 3,
  processing_status: "processing",
  processing_progress: 42,
  transcoded_filename: null,
};

const mockErrorVideo: Media = {
  ...mockVideo,
  id: 4,
  processing_status: "error",
  transcoded_filename: null,
};

it("shows processing overlay instead of video player for processing video", () => {
  render(
    <MediaDetailModal
      media={mockProcessingVideo}
      onClose={() => {}}
      onDelete={() => {}}
    />,
  );
  // Should NOT render a <video> element
  expect(document.querySelector("video")).toBeNull();
  // Should show thumbnail
  const img = screen.getByAltText("vacation.mp4");
  expect(img).toHaveAttribute("src", "/uploads/thumbnails/thumb_clip.jpg");
  // Should show processing progress
  expect(screen.getByText("42%")).toBeInTheDocument();
});

it("shows error overlay instead of video player for error video", () => {
  render(
    <MediaDetailModal
      media={mockErrorVideo}
      onClose={() => {}}
      onDelete={() => {}}
    />,
  );
  expect(document.querySelector("video")).toBeNull();
  const img = screen.getByAltText("vacation.mp4");
  expect(img).toHaveAttribute("src", "/uploads/thumbnails/thumb_clip.jpg");
  expect(screen.getByText("Failed")).toBeInTheDocument();
});

it("shows processing overlay for processing photo", () => {
  const processingPhoto: Media = {
    ...mockPhoto,
    processing_status: "processing",
    processing_progress: 75,
  };
  render(
    <MediaDetailModal
      media={processingPhoto}
      onClose={() => {}}
      onDelete={() => {}}
    />,
  );
  // Should show thumbnail (not original)
  const imgs = screen.getAllByAltText("sunset.jpg");
  // At least one img should use thumbnail URL
  const hasThumbnail = imgs.some((img) =>
    img.getAttribute("src")?.includes("/uploads/thumbnails/"),
  );
  expect(hasThumbnail).toBe(true);
  expect(screen.getByText("75%")).toBeInTheDocument();
});
```

**Step 2: Run test to verify it fails**

Run: `docker compose exec frontend npx vitest run src/__tests__/MediaDetailModal.test.tsx --reporter=verbose`
Expected: FAIL — video element rendered, no processing overlay.

**Step 3: Implement processing/error state in media area**

In `frontend/src/components/MediaDetailModal.tsx`, replace the media area block (lines 209-240) with:

```tsx
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
```

**Step 4: Run test to verify it passes**

Run: `docker compose exec frontend npx vitest run src/__tests__/MediaDetailModal.test.tsx --reporter=verbose`
Expected: PASS

**Step 5: Commit**

```bash
git add frontend/src/components/MediaDetailModal.tsx frontend/src/__tests__/MediaDetailModal.test.tsx
git commit -m "feat: show processing/error overlays in media detail modal"
```

---

### Task 4: MediaDetailModal — Disable jump button for non-ready media

**Files:**
- Modify: `frontend/src/components/MediaDetailModal.tsx:96-133`
- Modify: `frontend/src/__tests__/MediaDetailModal.test.tsx`

**Step 1: Write failing tests**

Add to `frontend/src/__tests__/MediaDetailModal.test.tsx` (reuse `mockProcessingVideo` and `mockErrorVideo` from Task 3):

```tsx
it("jump button is disabled for processing media", () => {
  render(
    <MediaDetailModal
      media={mockProcessingVideo}
      onClose={() => {}}
      onDelete={() => {}}
    />,
  );
  const jumpBtn = screen.getByLabelText("Show in slideshow");
  expect(jumpBtn).toBeDisabled();
  expect(jumpBtn).toHaveAttribute("title", "Not available while processing");
});

it("jump button is disabled for error media", () => {
  render(
    <MediaDetailModal
      media={mockErrorVideo}
      onClose={() => {}}
      onDelete={() => {}}
    />,
  );
  const jumpBtn = screen.getByLabelText("Show in slideshow");
  expect(jumpBtn).toBeDisabled();
  expect(jumpBtn).toHaveAttribute("title", "Not available for failed media");
});

it("jump button is enabled for ready media", () => {
  render(
    <MediaDetailModal
      media={mockPhoto}
      onClose={() => {}}
      onDelete={() => {}}
    />,
  );
  const jumpBtn = screen.getByLabelText("Show in slideshow");
  expect(jumpBtn).not.toBeDisabled();
  expect(jumpBtn).not.toHaveAttribute("title");
});
```

**Step 2: Run test to verify it fails**

Run: `docker compose exec frontend npx vitest run src/__tests__/MediaDetailModal.test.tsx --reporter=verbose`
Expected: FAIL — button not disabled.

**Step 3: Add disabled state to jump button**

In `frontend/src/components/MediaDetailModal.tsx`, update the jump button (lines 97-133). Compute these values before the return:

```tsx
const isReady = media.processing_status === "ready";
const jumpTitle = media.processing_status === "processing"
  ? "Not available while processing"
  : media.processing_status === "error"
    ? "Not available for failed media"
    : undefined;
```

Update the button:

```tsx
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
```

Note: `btn.blur()` also fixes the stuck focus state (Task 5 below). We capture `e.currentTarget` before the `await` because React nullifies the synthetic event.

**Step 4: Run test to verify it passes**

Run: `docker compose exec frontend npx vitest run src/__tests__/MediaDetailModal.test.tsx --reporter=verbose`
Expected: PASS

**Step 5: Commit**

```bash
git add frontend/src/components/MediaDetailModal.tsx frontend/src/__tests__/MediaDetailModal.test.tsx
git commit -m "fix: disable jump-to-slideshow for non-ready media, fix stuck focus"
```

---

### Task 5: Backend — Reject slideshow jump for non-ready media

**Files:**
- Modify: `backend/app/routers/media.py:278-286`
- Modify: `backend/tests/integration/test_slideshow_jump.py`

**Step 1: Write failing test**

Add to `backend/tests/integration/test_slideshow_jump.py`:

```python
def test_slideshow_jump_processing_media(client, sample_video_webm):
    """POST /api/media/slideshow/jump with processing media returns 400."""
    resp = client.post(
        "/api/media",
        files=[("files", ("test.webm", sample_video_webm, "video/webm"))],
    )
    assert resp.status_code == 200
    media_id = resp.json()[0]["id"]

    # Manually set processing_status to "processing" to simulate in-progress transcode
    from backend.app.database import SessionLocal
    from backend.app.models import Media

    db = SessionLocal()
    try:
        media = db.query(Media).filter(Media.id == media_id).first()
        media.processing_status = "processing"
        db.commit()
    finally:
        db.close()

    resp = client.post("/api/media/slideshow/jump", json={"media_id": media_id})
    assert resp.status_code == 400
    assert "not ready" in resp.json()["detail"].lower()


def test_slideshow_jump_error_media(client, sample_jpeg):
    """POST /api/media/slideshow/jump with error media returns 400."""
    resp = client.post(
        "/api/media",
        files=[("files", ("test.jpg", sample_jpeg, "image/jpeg"))],
    )
    assert resp.status_code == 200
    media_id = resp.json()[0]["id"]

    from backend.app.database import SessionLocal
    from backend.app.models import Media

    db = SessionLocal()
    try:
        media = db.query(Media).filter(Media.id == media_id).first()
        media.processing_status = "error"
        db.commit()
    finally:
        db.close()

    resp = client.post("/api/media/slideshow/jump", json={"media_id": media_id})
    assert resp.status_code == 400
    assert "not ready" in resp.json()["detail"].lower()
```

**Step 2: Run test to verify it fails**

Run: `docker compose exec backend python -m pytest tests/integration/test_slideshow_jump.py -v`
Expected: FAIL — returns 200 instead of 400.

**Step 3: Add processing status check to slideshow_jump**

In `backend/app/routers/media.py`, update `slideshow_jump` (line 279-286):

```python
@router.post("/slideshow/jump")
async def slideshow_jump(body: SlideshowJumpRequest, db: Session = Depends(get_db)):
    media = db.query(Media).filter(Media.id == body.media_id).first()
    if not media:
        raise HTTPException(404, "Media not found")
    if media.processing_status != "ready":
        raise HTTPException(400, "Media is not ready for slideshow")
    asyncio.create_task(
        manager.broadcast({"type": "slideshow_jump", "payload": {"id": body.media_id}})
    )
    return {"ok": True}
```

**Step 4: Run test to verify it passes**

Run: `docker compose exec backend python -m pytest tests/integration/test_slideshow_jump.py -v`
Expected: PASS

**Step 5: Run full test suite**

Run: `docker compose exec backend python -m pytest tests/ -v`
Expected: All pass.

**Step 6: Commit**

```bash
git add backend/app/routers/media.py backend/tests/integration/test_slideshow_jump.py
git commit -m "fix: reject slideshow jump for non-ready media (400)"
```

---

### Task 6: Run full test suite and verify

**Step 1: Run backend tests**

Run: `docker compose exec backend python -m pytest tests/ -v`
Expected: All pass.

**Step 2: Run frontend tests**

Run: `docker compose exec frontend npx vitest run --reporter=verbose`
Expected: All pass.

**Step 3: Final commit (if any fixups needed)**

If all tests pass with no fixups, this task is done.
