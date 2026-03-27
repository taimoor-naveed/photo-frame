# Photo Crop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users define a crop region on photos so the slideshow displays just the interesting part, filling the screen.

**Architecture:** Backend stores three floats (`crop_x`, `crop_y`, `crop_scale`) on the media table — no image regeneration. Frontend applies CSS transforms in the slideshow and shows a crop editor in the gallery modal. WebSocket broadcasts `media_updated` events so the slideshow picks up crop changes live.

**Tech Stack:** Python/FastAPI/SQLAlchemy (backend), React/TypeScript/Tailwind (frontend), CSS transforms (rendering)

**Spec:** `docs/superpowers/specs/2026-03-28-photo-crop-design.md`

---

### Task 1: Backend — Add crop columns to Media model

**Files:**
- Modify: `backend/app/models.py:9-29`
- Modify: `backend/app/schemas.py:7-23`
- Test: `backend/tests/unit/test_schemas.py`

- [ ] **Step 1: Add crop columns to Media model**

In `backend/app/models.py`, add three nullable Float columns after `content_hash` (line 26):

```python
crop_x: Mapped[float | None] = mapped_column(Float, nullable=True)
crop_y: Mapped[float | None] = mapped_column(Float, nullable=True)
crop_scale: Mapped[float | None] = mapped_column(Float, nullable=True)
```

- [ ] **Step 2: Add crop fields to MediaOut schema**

In `backend/app/schemas.py`, add to `MediaOut` class after `uploaded_at` (line 21):

```python
crop_x: float | None = None
crop_y: float | None = None
crop_scale: float | None = None
```

- [ ] **Step 3: Add CropRequest schema**

In `backend/app/schemas.py`, add after `MediaOut`:

```python
class CropRequest(BaseModel):
    crop_x: float = Field(ge=0, le=1)
    crop_y: float = Field(ge=0, le=1)
    crop_scale: float = Field(ge=1)

    @model_validator(mode="after")
    def reject_explicit_nulls(self):
        """Reject explicit null values — None is only valid as 'field not sent'."""
        for field_name in self.model_fields_set:
            if getattr(self, field_name) is None:
                raise ValueError(f"{field_name} cannot be null")
        return self
```

**Note:** This follows the same pattern as `SettingsUpdate` — lesson from QA Round 2 where `Optional` fields accepted explicit `null` and caused 500s.

- [ ] **Step 4: Write schema validation tests**

In `backend/tests/unit/test_schemas.py`, add tests:

```python
from app.schemas import CropRequest
from pydantic import ValidationError
import pytest


class TestCropRequest:
    def test_valid_crop(self):
        req = CropRequest(crop_x=0.5, crop_y=0.3, crop_scale=1.5)
        assert req.crop_x == 0.5
        assert req.crop_y == 0.3
        assert req.crop_scale == 1.5

    def test_boundary_values(self):
        CropRequest(crop_x=0.0, crop_y=0.0, crop_scale=1.0)
        CropRequest(crop_x=1.0, crop_y=1.0, crop_scale=1.0)

    def test_crop_x_out_of_range(self):
        with pytest.raises(ValidationError):
            CropRequest(crop_x=-0.1, crop_y=0.5, crop_scale=1.0)
        with pytest.raises(ValidationError):
            CropRequest(crop_x=1.1, crop_y=0.5, crop_scale=1.0)

    def test_crop_y_out_of_range(self):
        with pytest.raises(ValidationError):
            CropRequest(crop_x=0.5, crop_y=-0.1, crop_scale=1.0)
        with pytest.raises(ValidationError):
            CropRequest(crop_x=0.5, crop_y=1.1, crop_scale=1.0)

    def test_crop_scale_below_minimum(self):
        with pytest.raises(ValidationError):
            CropRequest(crop_x=0.5, crop_y=0.5, crop_scale=0.9)

    def test_crop_scale_at_minimum(self):
        req = CropRequest(crop_x=0.5, crop_y=0.5, crop_scale=1.0)
        assert req.crop_scale == 1.0

    def test_explicit_null_crop_x_rejected(self):
        """Lesson from QA Round 2: explicit null must be rejected, not silently accepted."""
        with pytest.raises(ValidationError):
            CropRequest(crop_x=None, crop_y=0.5, crop_scale=1.0)

    def test_explicit_null_crop_y_rejected(self):
        with pytest.raises(ValidationError):
            CropRequest(crop_x=0.5, crop_y=None, crop_scale=1.0)

    def test_explicit_null_crop_scale_rejected(self):
        with pytest.raises(ValidationError):
            CropRequest(crop_x=0.5, crop_y=0.5, crop_scale=None)
```

- [ ] **Step 5: Run schema tests**

Run: `docker compose exec backend python -m pytest tests/unit/test_schemas.py -v`
Expected: All `TestCropRequest` tests PASS

- [ ] **Step 6: Commit**

```bash
git add backend/app/models.py backend/app/schemas.py backend/tests/unit/test_schemas.py
git commit -m "feat: add crop columns to Media model and CropRequest schema"
```

---

### Task 2: Backend — Crop API endpoints

**Files:**
- Modify: `backend/app/routers/media.py`
- Modify: `backend/app/websocket.py` (no changes needed — reuse existing broadcast)
- Modify: `backend/hooks/useWebSocket.ts` (add `media_updated` to WsEvent type)
- Test: `backend/tests/integration/test_crop_api.py` (create)

- [ ] **Step 1: Write failing integration tests for crop endpoints**

Create `backend/tests/integration/test_crop_api.py`:

```python
import pytest


def _upload_photo(client, sample_jpeg):
    """Upload a photo and return the media dict."""
    resp = client.post(
        "/api/media",
        files=[("files", ("test.jpg", sample_jpeg, "image/jpeg"))],
    )
    assert resp.status_code == 200
    return resp.json()[0]


def _upload_video(client, sample_video):
    """Upload a video and return the media dict."""
    resp = client.post(
        "/api/media",
        files=[("files", ("test.mp4", sample_video, "video/mp4"))],
    )
    assert resp.status_code == 200
    return resp.json()[0]


class TestSetCrop:
    def test_set_crop_on_photo(self, client, sample_jpeg):
        media = _upload_photo(client, sample_jpeg)
        resp = client.put(
            f"/api/media/{media['id']}/crop",
            json={"crop_x": 0.3, "crop_y": 0.2, "crop_scale": 1.5},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["crop_x"] == pytest.approx(0.3)
        assert data["crop_y"] == pytest.approx(0.2)
        assert data["crop_scale"] == pytest.approx(1.5)

    def test_update_existing_crop(self, client, sample_jpeg):
        media = _upload_photo(client, sample_jpeg)
        client.put(
            f"/api/media/{media['id']}/crop",
            json={"crop_x": 0.3, "crop_y": 0.2, "crop_scale": 1.5},
        )
        resp = client.put(
            f"/api/media/{media['id']}/crop",
            json={"crop_x": 0.6, "crop_y": 0.8, "crop_scale": 2.0},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["crop_x"] == pytest.approx(0.6)
        assert data["crop_scale"] == pytest.approx(2.0)

    def test_set_crop_on_video_rejected(self, client, sample_video):
        media = _upload_video(client, sample_video)
        resp = client.put(
            f"/api/media/{media['id']}/crop",
            json={"crop_x": 0.5, "crop_y": 0.5, "crop_scale": 1.0},
        )
        assert resp.status_code == 400
        assert "photo" in resp.text.lower() or "video" in resp.text.lower()

    def test_set_crop_not_found(self, client):
        resp = client.put(
            "/api/media/99999/crop",
            json={"crop_x": 0.5, "crop_y": 0.5, "crop_scale": 1.0},
        )
        assert resp.status_code == 404

    def test_set_crop_invalid_values(self, client, sample_jpeg):
        media = _upload_photo(client, sample_jpeg)
        # crop_x out of range
        resp = client.put(
            f"/api/media/{media['id']}/crop",
            json={"crop_x": 1.5, "crop_y": 0.5, "crop_scale": 1.0},
        )
        assert resp.status_code == 422

        # crop_scale below 1
        resp = client.put(
            f"/api/media/{media['id']}/crop",
            json={"crop_x": 0.5, "crop_y": 0.5, "crop_scale": 0.5},
        )
        assert resp.status_code == 422

        # missing field
        resp = client.put(
            f"/api/media/{media['id']}/crop",
            json={"crop_x": 0.5, "crop_y": 0.5},
        )
        assert resp.status_code == 422

    def test_crop_persists_in_get(self, client, sample_jpeg):
        media = _upload_photo(client, sample_jpeg)
        client.put(
            f"/api/media/{media['id']}/crop",
            json={"crop_x": 0.3, "crop_y": 0.2, "crop_scale": 1.5},
        )
        resp = client.get(f"/api/media/{media['id']}")
        assert resp.status_code == 200
        data = resp.json()
        assert data["crop_x"] == pytest.approx(0.3)
        assert data["crop_y"] == pytest.approx(0.2)
        assert data["crop_scale"] == pytest.approx(1.5)

    def test_crop_appears_in_list(self, client, sample_jpeg):
        media = _upload_photo(client, sample_jpeg)
        client.put(
            f"/api/media/{media['id']}/crop",
            json={"crop_x": 0.4, "crop_y": 0.5, "crop_scale": 1.8},
        )
        resp = client.get("/api/media")
        assert resp.status_code == 200
        items = resp.json()["items"]
        item = next(i for i in items if i["id"] == media["id"])
        assert item["crop_x"] == pytest.approx(0.4)


class TestRemoveCrop:
    def test_remove_crop(self, client, sample_jpeg):
        media = _upload_photo(client, sample_jpeg)
        client.put(
            f"/api/media/{media['id']}/crop",
            json={"crop_x": 0.3, "crop_y": 0.2, "crop_scale": 1.5},
        )
        resp = client.delete(f"/api/media/{media['id']}/crop")
        assert resp.status_code == 200
        data = resp.json()
        assert data["crop_x"] is None
        assert data["crop_y"] is None
        assert data["crop_scale"] is None

    def test_remove_crop_when_none_exists(self, client, sample_jpeg):
        media = _upload_photo(client, sample_jpeg)
        resp = client.delete(f"/api/media/{media['id']}/crop")
        assert resp.status_code == 200
        data = resp.json()
        assert data["crop_x"] is None

    def test_remove_crop_not_found(self, client):
        resp = client.delete("/api/media/99999/crop")
        assert resp.status_code == 404

    def test_remove_crop_persists(self, client, sample_jpeg):
        media = _upload_photo(client, sample_jpeg)
        client.put(
            f"/api/media/{media['id']}/crop",
            json={"crop_x": 0.3, "crop_y": 0.2, "crop_scale": 1.5},
        )
        client.delete(f"/api/media/{media['id']}/crop")
        resp = client.get(f"/api/media/{media['id']}")
        data = resp.json()
        assert data["crop_x"] is None
        assert data["crop_y"] is None
        assert data["crop_scale"] is None


class TestCropExplicitNulls:
    """Lesson from QA Round 2: explicit null in JSON must return 422, not 500."""

    def test_explicit_null_crop_x(self, client, sample_jpeg):
        media = _upload_photo(client, sample_jpeg)
        resp = client.put(
            f"/api/media/{media['id']}/crop",
            json={"crop_x": None, "crop_y": 0.5, "crop_scale": 1.0},
        )
        assert resp.status_code == 422

    def test_explicit_null_crop_y(self, client, sample_jpeg):
        media = _upload_photo(client, sample_jpeg)
        resp = client.put(
            f"/api/media/{media['id']}/crop",
            json={"crop_x": 0.5, "crop_y": None, "crop_scale": 1.0},
        )
        assert resp.status_code == 422

    def test_explicit_null_crop_scale(self, client, sample_jpeg):
        media = _upload_photo(client, sample_jpeg)
        resp = client.put(
            f"/api/media/{media['id']}/crop",
            json={"crop_x": 0.5, "crop_y": 0.5, "crop_scale": None},
        )
        assert resp.status_code == 422


class TestCropIntegerOverflow:
    """Lesson from QA Round 2: huge ints for IDs must not cause 500."""

    def test_set_crop_huge_media_id(self, client):
        huge_id = 2**63
        resp = client.put(
            f"/api/media/{huge_id}/crop",
            json={"crop_x": 0.5, "crop_y": 0.5, "crop_scale": 1.0},
        )
        assert resp.status_code in (404, 422)

    def test_remove_crop_huge_media_id(self, client):
        huge_id = 2**63
        resp = client.delete(f"/api/media/{huge_id}/crop")
        assert resp.status_code in (404, 422)


class TestCropWebSocketBroadcast:
    """Cross-boundary: verify WS broadcast payload has correct field names."""

    def test_set_crop_broadcasts_media_updated(self, client, sample_jpeg):
        media = _upload_photo(client, sample_jpeg)
        # Connect WebSocket before setting crop
        with client.websocket_connect("/ws") as ws:
            client.put(
                f"/api/media/{media['id']}/crop",
                json={"crop_x": 0.3, "crop_y": 0.2, "crop_scale": 1.5},
            )
            msg = ws.receive_json()
            assert msg["type"] == "media_updated"
            payload = msg["payload"]
            # Verify payload has crop fields with correct names and values
            assert payload["crop_x"] == pytest.approx(0.3)
            assert payload["crop_y"] == pytest.approx(0.2)
            assert payload["crop_scale"] == pytest.approx(1.5)
            # Verify payload has all standard MediaOut fields
            assert payload["id"] == media["id"]
            assert payload["filename"] == media["filename"]
            assert payload["media_type"] == "photo"

    def test_remove_crop_broadcasts_media_updated(self, client, sample_jpeg):
        media = _upload_photo(client, sample_jpeg)
        client.put(
            f"/api/media/{media['id']}/crop",
            json={"crop_x": 0.3, "crop_y": 0.2, "crop_scale": 1.5},
        )
        with client.websocket_connect("/ws") as ws:
            client.delete(f"/api/media/{media['id']}/crop")
            msg = ws.receive_json()
            assert msg["type"] == "media_updated"
            payload = msg["payload"]
            assert payload["crop_x"] is None
            assert payload["crop_y"] is None
            assert payload["crop_scale"] is None


class TestUploadedMediaHasNoCrop:
    def test_new_upload_has_no_crop(self, client, sample_jpeg):
        media = _upload_photo(client, sample_jpeg)
        assert media["crop_x"] is None
        assert media["crop_y"] is None
        assert media["crop_scale"] is None
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `docker compose exec backend python -m pytest tests/integration/test_crop_api.py -v`
Expected: FAIL — endpoints don't exist yet

- [ ] **Step 3: Implement crop endpoints**

In `backend/app/routers/media.py`, add these imports at the top (around line 12):

```python
from app.schemas import CropRequest
```

Add these two endpoints before the `get_media` endpoint (before line 392). They must be placed before `/{media_id}` to avoid route conflicts:

```python
@router.put("/{media_id}/crop", response_model=MediaOut)
async def set_crop(media_id: int, body: CropRequest, db: Session = Depends(get_db)):
    media = db.query(Media).filter(Media.id == media_id).first()
    if not media:
        raise HTTPException(404, "Media not found")
    if media.media_type != "photo":
        raise HTTPException(400, "Crop is only supported for photos")

    media.crop_x = body.crop_x
    media.crop_y = body.crop_y
    media.crop_scale = body.crop_scale
    db.commit()
    db.refresh(media)

    await manager.broadcast({"type": "media_updated", "payload": MediaOut.model_validate(media).model_dump(mode="json")})

    return media


@router.delete("/{media_id}/crop", response_model=MediaOut)
async def remove_crop(media_id: int, db: Session = Depends(get_db)):
    media = db.query(Media).filter(Media.id == media_id).first()
    if not media:
        raise HTTPException(404, "Media not found")

    media.crop_x = None
    media.crop_y = None
    media.crop_scale = None
    db.commit()
    db.refresh(media)

    await manager.broadcast({"type": "media_updated", "payload": MediaOut.model_validate(media).model_dump(mode="json")})

    return media
```

Also add `CropRequest` to the import from `app.schemas` at the top of the file.

- [ ] **Step 4: Run integration tests**

Run: `docker compose exec backend python -m pytest tests/integration/test_crop_api.py -v`
Expected: All PASS

- [ ] **Step 5: Run full backend test suite to check for regressions**

Run: `docker compose exec backend python -m pytest -v`
Expected: All existing tests still PASS

- [ ] **Step 6: Commit**

```bash
git add backend/app/routers/media.py backend/app/schemas.py backend/tests/integration/test_crop_api.py
git commit -m "feat: add PUT/DELETE /api/media/{id}/crop endpoints"
```

---

### Task 3: Frontend — Add crop fields to Media type and API client

**Files:**
- Modify: `frontend/src/api/client.ts:3-19` (Media interface)
- Modify: `frontend/src/api/client.ts:61-116` (api object)
- Modify: `frontend/src/hooks/useWebSocket.ts:4-12` (WsEvent type)
- Test: `frontend/src/__tests__/clientUrls.test.ts`

- [ ] **Step 1: Add crop fields to Media interface**

In `frontend/src/api/client.ts`, add after `uploaded_at` (line 18):

```typescript
crop_x: number | null;
crop_y: number | null;
crop_scale: number | null;
```

- [ ] **Step 2: Add crop API methods**

In `frontend/src/api/client.ts`, add inside the `media` object after `bulkDelete` (after line 115):

```typescript
    setCrop(id: number, crop: { crop_x: number; crop_y: number; crop_scale: number }): Promise<Media> {
      return request(`/media/${id}/crop`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(crop),
      });
    },
    removeCrop(id: number): Promise<Media> {
      return request(`/media/${id}/crop`, { method: "DELETE" });
    },
```

- [ ] **Step 3: Add `media_updated` to WsEvent type**

In `frontend/src/hooks/useWebSocket.ts`, add `"media_updated"` to the `type` union (line 11):

```typescript
export interface WsEvent {
  type:
    | "media_added"
    | "media_deleted"
    | "media_processing_complete"
    | "media_processing_error"
    | "media_processing_progress"
    | "media_updated"
    | "settings_changed"
    | "slideshow_jump";
  payload: Record<string, unknown>;
}
```

- [ ] **Step 4: Update all mock Media objects in test files**

Add `crop_x: null, crop_y: null, crop_scale: null` to every mock Media object in:

- `frontend/src/__tests__/MediaDetailModal.test.tsx` — `mockPhoto` (after line 18)
- `frontend/src/__tests__/SlideshowPage.test.tsx` — `makePhoto()` and `makeVideo()` (after the `content_hash` line in each)
- `frontend/src/__tests__/GalleryPage.test.tsx` — any mock Media objects
- `frontend/src/__tests__/PhotoCard.test.tsx` — any mock Media objects
- `frontend/src/__tests__/SelectionActionBar.test.tsx` — any mock Media objects
- `frontend/src/__tests__/clientUrls.test.ts` — any mock Media objects

Every file that creates a `Media` object must include the three new fields.

- [ ] **Step 5: Run frontend tests to verify no regressions**

Run: `docker compose exec frontend npx vitest run`
Expected: All PASS

- [ ] **Step 6: Commit**

```bash
git add frontend/src/api/client.ts frontend/src/hooks/useWebSocket.ts frontend/src/__tests__/
git commit -m "feat: add crop fields to Media type, API methods, and WsEvent"
```

---

### Task 4: Frontend — Handle `media_updated` in Slideshow and Gallery

**Files:**
- Modify: `frontend/src/pages/SlideshowPage.tsx:206-293` (handleWsEvent)
- Modify: `frontend/src/hooks/usePhotos.ts` (if it handles WS events)
- Test: `frontend/src/__tests__/SlideshowPage.test.tsx`

- [ ] **Step 1: Check if usePhotos handles WS events**

Read `frontend/src/hooks/usePhotos.ts` to understand if it listens for WS events to update the gallery photo list. If it does, add `media_updated` handling there too.

- [ ] **Step 2: Write failing test for media_updated WS event in slideshow**

In `frontend/src/__tests__/SlideshowPage.test.tsx`, add:

```typescript
it("updates current slide when media_updated WS event received", async () => {
  const { fetchMock } = setupFetchMock();
  render(
    <MemoryRouter initialEntries={["/slideshow"]}>
      <SlideshowPage />
    </MemoryRouter>,
  );

  await waitFor(() => {
    expect(screen.getByAltText("photo1.jpg")).toBeInTheDocument();
  });

  // Simulate media_updated event with crop data
  const ws = wsInstances[wsInstances.length - 1];
  const updatedPhoto = {
    ...makePhoto(1),
    crop_x: 0.3,
    crop_y: 0.2,
    crop_scale: 1.5,
  };
  act(() => {
    ws.simulateMessage({ type: "media_updated", payload: updatedPhoto });
  });

  // The slide should re-render — verify the media object was updated
  // by checking that the foreground img has a transform style applied
  await waitFor(() => {
    const imgs = screen.getAllByAltText("photo1.jpg");
    const foreground = imgs.find((img) => !img.getAttribute("aria-hidden"));
    expect(foreground).toBeDefined();
    expect(foreground!.style.transform).toContain("scale");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `docker compose exec frontend npx vitest run SlideshowPage`
Expected: FAIL — `media_updated` not handled yet

- [ ] **Step 4: Add media_updated handler to SlideshowPage**

In `frontend/src/pages/SlideshowPage.tsx`, inside `handleWsEvent` (after the `slideshow_jump` block around line 289), add:

```typescript
} else if (event.type === "media_updated") {
  const updated = event.payload as unknown as Media;
  setMediaList((prev) =>
    prev.map((m) => (m.id === updated.id ? updated : m)),
  );
  setSlide((prev) => {
    if (!prev.playlist.some((m) => m.id === updated.id)) return prev;
    return {
      ...prev,
      playlist: prev.playlist.map((m) =>
        m.id === updated.id ? updated : m,
      ),
    };
  });
}
```

- [ ] **Step 5: Add media_updated handler to usePhotos (if applicable)**

If `usePhotos.ts` handles WS events, add the same pattern: update the media item in-place when `media_updated` is received.

- [ ] **Step 6: Run tests**

Run: `docker compose exec frontend npx vitest run`
Expected: All PASS

- [ ] **Step 7: Commit**

```bash
git add frontend/src/pages/SlideshowPage.tsx frontend/src/hooks/usePhotos.ts
git commit -m "feat: handle media_updated WS event in slideshow and gallery"
```

---

### Task 5: Frontend — Apply crop transform in Slideshow Slide component

**Files:**
- Modify: `frontend/src/pages/SlideshowPage.tsx:474-517` (Slide component)
- Test: `frontend/src/__tests__/SlideshowPage.test.tsx`

- [ ] **Step 1: Write failing test for crop rendering**

In `frontend/src/__tests__/SlideshowPage.test.tsx`, add:

```typescript
it("applies crop transform to foreground image when crop data present", async () => {
  const croppedPhoto = { ...makePhoto(1), crop_x: 0.3, crop_y: 0.2, crop_scale: 1.5 };
  const mediaWithCrop: MediaList = {
    items: [croppedPhoto],
    total: 1,
    page: 1,
    per_page: 100,
  };
  setupFetchMock(mediaWithCrop);

  render(
    <MemoryRouter initialEntries={["/slideshow"]}>
      <SlideshowPage />
    </MemoryRouter>,
  );

  await waitFor(() => {
    const imgs = screen.getAllByRole("img");
    // Find the foreground img (not aria-hidden)
    const foreground = imgs.find(
      (img) => !img.getAttribute("aria-hidden") && img.getAttribute("alt") === "photo1.jpg",
    );
    expect(foreground).toBeDefined();
    expect(foreground!.className).toContain("object-none");
  });
});

it("does not apply crop transform when no crop data", async () => {
  setupFetchMock();
  render(
    <MemoryRouter initialEntries={["/slideshow"]}>
      <SlideshowPage />
    </MemoryRouter>,
  );

  await waitFor(() => {
    const imgs = screen.getAllByRole("img");
    const foreground = imgs.find(
      (img) => !img.getAttribute("aria-hidden") && img.getAttribute("alt") === "sunset.jpg",
    );
    expect(foreground).toBeDefined();
    expect(foreground!.className).toContain("object-contain");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `docker compose exec frontend npx vitest run SlideshowPage`
Expected: FAIL

- [ ] **Step 3: Implement crop transform in Slide component**

In `frontend/src/pages/SlideshowPage.tsx`, modify the `Slide` component's photo rendering (lines 506-516).

Add a helper function above the `Slide` component:

```typescript
/** Compute inline style for a cropped photo in the slideshow. */
function cropStyle(media: Media): React.CSSProperties | undefined {
  if (media.crop_scale == null) return undefined;
  const { crop_x, crop_y, crop_scale } = media;
  // Transform origin at the crop center point, then scale up
  return {
    objectFit: "none" as const,
    objectPosition: `${(crop_x ?? 0.5) * 100}% ${(crop_y ?? 0.5) * 100}%`,
    transform: `scale(${crop_scale})`,
  };
}
```

Then update the photo `<img>` in the Slide component:

```typescript
return (
  <>
    <img src={src} className={CSS_BLUR_CLASS} alt="" aria-hidden="true" />
    <img
      src={src}
      data-media-id={media.id}
      className={`absolute inset-0 w-full h-full ${media.crop_scale != null ? "object-none" : "object-contain"}`}
      style={cropStyle(media)}
      alt={media.original_name}
    />
  </>
);
```

**Note:** The exact CSS approach for crop rendering may need refinement during implementation. The key idea is:
- Without crop: `object-contain` (current behavior)
- With crop: Use `object-position` to center on the crop point, `transform: scale()` to zoom in, and `overflow: hidden` (from the parent) to clip

If `object-fit: none` + `object-position` doesn't map cleanly to the crop model (since the image's natural size varies), an alternative approach is to use a wrapper `<div>` with `overflow: hidden` and transform the `<img>` inside it:

```typescript
{media.crop_scale != null ? (
  <>
    <img src={src} className={CSS_BLUR_CLASS} alt="" aria-hidden="true" />
    <div className="absolute inset-0 overflow-hidden">
      <img
        src={src}
        data-media-id={media.id}
        className="absolute w-full h-full object-cover"
        style={{
          transformOrigin: `${(media.crop_x ?? 0.5) * 100}% ${(media.crop_y ?? 0.5) * 100}%`,
          transform: `scale(${media.crop_scale})`,
        }}
        alt={media.original_name}
      />
    </div>
  </>
) : (
  <>
    <img src={src} className={CSS_BLUR_CLASS} alt="" aria-hidden="true" />
    <img
      src={src}
      data-media-id={media.id}
      className="absolute inset-0 w-full h-full object-contain"
      alt={media.original_name}
    />
  </>
)}
```

The implementer should test both approaches visually using Playwright or the browser and pick whichever maps correctly to the crop editor's coordinate system.

- [ ] **Step 4: Run tests**

Run: `docker compose exec frontend npx vitest run SlideshowPage`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/SlideshowPage.tsx frontend/src/__tests__/SlideshowPage.test.tsx
git commit -m "feat: apply crop CSS transform in slideshow Slide component"
```

---

### Task 6: Frontend — Crop editor component

**Files:**
- Create: `frontend/src/components/CropEditor.tsx`
- Test: `frontend/src/__tests__/CropEditor.test.tsx` (create)

This is the most complex frontend component. It renders a fixed-aspect-ratio rectangle (1024:600) over the image, lets the user drag to pan and use a slider to zoom, then returns the computed `crop_x`, `crop_y`, `crop_scale` on save.

- [ ] **Step 1: Write basic render test**

Create `frontend/src/__tests__/CropEditor.test.tsx`:

```typescript
import { render, screen, fireEvent } from "@testing-library/react";
import CropEditor from "../components/CropEditor";

const defaultProps = {
  src: "/uploads/originals/test.jpg",
  imageWidth: 800,
  imageHeight: 1200,
  initialCrop: null as { crop_x: number; crop_y: number; crop_scale: number } | null,
  onSave: vi.fn(),
  onCancel: vi.fn(),
};

describe("CropEditor", () => {
  it("renders with Save and Cancel buttons", () => {
    render(<CropEditor {...defaultProps} />);
    expect(screen.getByRole("button", { name: /save/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /cancel/i })).toBeInTheDocument();
  });

  it("renders a zoom slider", () => {
    render(<CropEditor {...defaultProps} />);
    expect(screen.getByRole("slider")).toBeInTheDocument();
  });

  it("calls onCancel when Cancel is clicked", () => {
    const onCancel = vi.fn();
    render(<CropEditor {...defaultProps} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("calls onSave with crop data when Save is clicked", () => {
    const onSave = vi.fn();
    render(<CropEditor {...defaultProps} onSave={onSave} />);
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    expect(onSave).toHaveBeenCalledOnce();
    const cropData = onSave.mock.calls[0][0];
    expect(cropData).toHaveProperty("crop_x");
    expect(cropData).toHaveProperty("crop_y");
    expect(cropData).toHaveProperty("crop_scale");
    // Default position should be centered
    expect(cropData.crop_x).toBeCloseTo(0.5, 1);
    expect(cropData.crop_y).toBeCloseTo(0.5, 1);
    expect(cropData.crop_scale).toBeGreaterThanOrEqual(1);
  });

  it("initializes with existing crop data when provided", () => {
    const onSave = vi.fn();
    render(
      <CropEditor
        {...defaultProps}
        initialCrop={{ crop_x: 0.3, crop_y: 0.2, crop_scale: 1.8 }}
        onSave={onSave}
      />,
    );
    // Save immediately without adjusting — should return the initial values
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    const cropData = onSave.mock.calls[0][0];
    expect(cropData.crop_x).toBeCloseTo(0.3, 1);
    expect(cropData.crop_y).toBeCloseTo(0.2, 1);
    expect(cropData.crop_scale).toBeCloseTo(1.8, 1);
  });

  it("updates scale when zoom slider is changed", () => {
    const onSave = vi.fn();
    render(<CropEditor {...defaultProps} onSave={onSave} />);
    const slider = screen.getByRole("slider");
    fireEvent.change(slider, { target: { value: "2.5" } });
    // Save and verify the new scale
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    const cropData = onSave.mock.calls[0][0];
    expect(cropData.crop_scale).toBeCloseTo(2.5, 1);
  });

  it("clamps scale to minimum when slider is set below min", () => {
    const onSave = vi.fn();
    // Portrait image: min scale > 1.0 because image is taller than wide
    render(
      <CropEditor
        {...defaultProps}
        imageWidth={600}
        imageHeight={1200}
        onSave={onSave}
      />,
    );
    const slider = screen.getByRole("slider");
    // Try to set scale below minimum
    fireEvent.change(slider, { target: { value: "1.0" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    const cropData = onSave.mock.calls[0][0];
    // For 600x1200 portrait with 1024:600 display aspect, min scale > 1.0
    expect(cropData.crop_scale).toBeGreaterThanOrEqual(1.0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `docker compose exec frontend npx vitest run CropEditor`
Expected: FAIL — component doesn't exist

- [ ] **Step 3: Implement CropEditor component**

Create `frontend/src/components/CropEditor.tsx`:

```typescript
import { useCallback, useEffect, useRef, useState } from "react";

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

const DISPLAY_ASPECT = 1024 / 600; // ~1.707

export default function CropEditor({
  src,
  imageWidth,
  imageHeight,
  initialCrop,
  saving = false,
  onSave,
  onCancel,
}: CropEditorProps) {
  // State: crop center as fraction of image dimensions + zoom scale
  const [cropX, setCropX] = useState(initialCrop?.crop_x ?? 0.5);
  const [cropY, setCropY] = useState(initialCrop?.crop_y ?? 0.5);
  const [scale, setScale] = useState(initialCrop?.crop_scale ?? 1.0);

  // Refs for drag handling
  const containerRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const lastPointer = useRef({ x: 0, y: 0 });

  // Compute minimum scale so image fills the crop rectangle
  const imageAspect = imageWidth / imageHeight;
  const minScale = imageAspect > DISPLAY_ASPECT
    ? 1.0  // landscape image: height is the limiting dimension at scale 1
    : DISPLAY_ASPECT / imageAspect;  // portrait: need to zoom in so width fills

  // Ensure scale respects minimum
  useEffect(() => {
    if (scale < minScale) setScale(minScale);
  }, [minScale, scale]);

  // Clamp crop position so no empty space is visible
  const clamp = useCallback(
    (x: number, y: number, s: number): [number, number] => {
      // The crop rectangle shows (1/s) of the image in each dimension
      // Center must be at least halfVisible from each edge
      const halfW = 1 / (2 * s * (imageAspect > DISPLAY_ASPECT ? imageAspect / DISPLAY_ASPECT : 1));
      const halfH = 1 / (2 * s * (imageAspect > DISPLAY_ASPECT ? 1 : DISPLAY_ASPECT / imageAspect));
      const clampedX = Math.max(halfW, Math.min(1 - halfW, x));
      const clampedY = Math.max(halfH, Math.min(1 - halfH, y));
      return [clampedX, clampedY];
    },
    [imageAspect],
  );

  // Drag handlers
  const onPointerDown = useCallback((e: React.PointerEvent) => {
    dragging.current = true;
    lastPointer.current = { x: e.clientX, y: e.clientY };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragging.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const dx = (e.clientX - lastPointer.current.x) / rect.width;
      const dy = (e.clientY - lastPointer.current.y) / rect.height;
      lastPointer.current = { x: e.clientX, y: e.clientY };

      setCropX((prev) => {
        setCropY((prevY) => {
          const [, newY] = clamp(prev - dx, prevY - dy, scale);
          return newY;
        });
        const [newX] = clamp(prev - dx, cropY - dy, scale);
        return newX;
      });
    },
    [clamp, cropY, scale],
  );

  const onPointerUp = useCallback(() => {
    dragging.current = false;
  }, []);

  // Zoom via slider
  const onSliderChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const newScale = parseFloat(e.target.value);
      setScale(newScale);
      setCropX((prev) => {
        setCropY((prevY) => {
          const [, newY] = clamp(prev, prevY, newScale);
          return newY;
        });
        const [newX] = clamp(prev, cropY, newScale);
        return newX;
      });
    },
    [clamp, cropY],
  );

  const handleSave = useCallback(() => {
    const [cx, cy] = clamp(cropX, cropY, scale);
    onSave({ crop_x: cx, crop_y: cy, crop_scale: Math.max(scale, minScale) });
  }, [cropX, cropY, scale, minScale, clamp, onSave]);

  // Compute image transform for preview
  // The image is displayed to fill the container, then we translate based on crop center
  const imgStyle: React.CSSProperties = {
    transformOrigin: "center center",
    transform: `scale(${scale}) translate(${(0.5 - cropX) * 100}%, ${(0.5 - cropY) * 100}%)`,
    width: "100%",
    height: "100%",
    objectFit: "cover",
  };

  return (
    <div className="flex flex-col h-full">
      {/* Crop viewport */}
      <div className="flex-1 relative flex items-center justify-center bg-black overflow-hidden">
        {/* Dimmed full image behind */}
        <img
          src={src}
          className="absolute inset-0 w-full h-full object-contain brightness-[0.3]"
          alt=""
          aria-hidden="true"
          draggable={false}
        />

        {/* Crop rectangle with interactive image */}
        <div
          ref={containerRef}
          className="relative border-2 border-white/80 overflow-hidden cursor-grab active:cursor-grabbing"
          style={{ aspectRatio: `${1024} / ${600}`, maxWidth: "90%", maxHeight: "70%" }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <img
            src={src}
            style={imgStyle}
            alt="Crop preview"
            draggable={false}
          />
        </div>
      </div>

      {/* Controls bar */}
      <div className="flex items-center gap-3 px-4 py-3 bg-surface border-t border-white/[0.06]">
        {/* Zoom slider */}
        <span className="text-warm-gray text-sm">−</span>
        <input
          type="range"
          min={minScale}
          max={Math.max(minScale * 4, 4)}
          step={0.01}
          value={scale}
          onChange={onSliderChange}
          className="flex-1 accent-blue-500"
          aria-label="Zoom"
        />
        <span className="text-warm-gray text-sm">+</span>

        <div className="flex gap-2 ml-4">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm rounded-lg bg-white/[0.06] text-warm-gray hover:text-warm-white hover:bg-white/[0.1] transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
```

**Important implementation notes:**
- The drag math (converting pixel deltas to crop coordinate deltas) depends on how the image is rendered relative to the container. The code above is a starting point — the implementer should verify the pan direction and sensitivity visually using Playwright or the browser.
- Pinch-to-zoom can be added as an enhancement after the slider works.
- The `clamp` function ensures the crop window never shows empty space. The exact formula depends on image aspect ratio vs display aspect ratio — test with both portrait and landscape images.

- [ ] **Step 4: Run tests**

Run: `docker compose exec frontend npx vitest run CropEditor`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/CropEditor.tsx frontend/src/__tests__/CropEditor.test.tsx
git commit -m "feat: add CropEditor component with drag-to-pan and zoom slider"
```

---

### Task 7: Frontend — Integrate crop editor into MediaDetailModal

**Files:**
- Modify: `frontend/src/components/MediaDetailModal.tsx`
- Test: `frontend/src/__tests__/MediaDetailModal.test.tsx`

- [ ] **Step 1: Write failing tests**

In `frontend/src/__tests__/MediaDetailModal.test.tsx`, add:

```typescript
describe("Crop controls", () => {
  it("shows Add Crop button for photos without crop", () => {
    render(
      <MediaDetailModal media={mockPhoto} onClose={() => {}} onDelete={() => {}} />,
    );
    expect(screen.getByRole("button", { name: /add crop/i })).toBeInTheDocument();
  });

  it("does not show crop button for videos", () => {
    render(
      <MediaDetailModal media={mockVideo} onClose={() => {}} onDelete={() => {}} />,
    );
    expect(screen.queryByRole("button", { name: /add crop/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /edit crop/i })).not.toBeInTheDocument();
  });

  it("shows Edit Crop and Remove Crop buttons when crop exists", () => {
    const croppedPhoto = { ...mockPhoto, crop_x: 0.3, crop_y: 0.2, crop_scale: 1.5 };
    render(
      <MediaDetailModal media={croppedPhoto} onClose={() => {}} onDelete={() => {}} />,
    );
    expect(screen.getByRole("button", { name: /edit crop/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /remove crop/i })).toBeInTheDocument();
  });

  it("shows dimmed overlay when photo has crop", () => {
    const croppedPhoto = { ...mockPhoto, crop_x: 0.3, crop_y: 0.2, crop_scale: 1.5 };
    render(
      <MediaDetailModal media={croppedPhoto} onClose={() => {}} onDelete={() => {}} />,
    );
    // The crop overlay container should be present
    expect(screen.getByTestId("crop-overlay")).toBeInTheDocument();
  });

  it("opens crop editor when Add Crop is clicked", () => {
    render(
      <MediaDetailModal media={mockPhoto} onClose={() => {}} onDelete={() => {}} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /add crop/i }));
    // CropEditor should now be visible with Save/Cancel
    expect(screen.getByRole("button", { name: /save/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /cancel/i })).toBeInTheDocument();
  });

  it("does not show crop buttons for processing photos", () => {
    const processingPhoto = { ...mockPhoto, processing_status: "processing" as const };
    render(
      <MediaDetailModal media={processingPhoto} onClose={() => {}} onDelete={() => {}} />,
    );
    expect(screen.queryByRole("button", { name: /add crop/i })).not.toBeInTheDocument();
  });

  it("shows error banner when save crop API fails", async () => {
    // Mock fetch to return 500 for the crop PUT endpoint
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn((url: string, opts?: RequestInit) => {
      if (typeof url === "string" && url.includes("/crop") && opts?.method === "PUT") {
        return Promise.resolve(new Response("Internal Server Error", { status: 500 }));
      }
      return originalFetch(url, opts);
    }) as typeof fetch;

    render(
      <MediaDetailModal media={mockPhoto} onClose={() => {}} onDelete={() => {}} />,
    );
    // Open editor and save
    fireEvent.click(screen.getByRole("button", { name: /add crop/i }));
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() => {
      expect(screen.getByText(/failed to save crop/i)).toBeInTheDocument();
    });

    globalThis.fetch = originalFetch;
  });

  it("shows error banner when remove crop API fails", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn((url: string, opts?: RequestInit) => {
      if (typeof url === "string" && url.includes("/crop") && opts?.method === "DELETE") {
        return Promise.resolve(new Response("Internal Server Error", { status: 500 }));
      }
      return originalFetch(url, opts);
    }) as typeof fetch;

    const croppedPhoto = { ...mockPhoto, crop_x: 0.3, crop_y: 0.2, crop_scale: 1.5 };
    render(
      <MediaDetailModal media={croppedPhoto} onClose={() => {}} onDelete={() => {}} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /remove crop/i }));
    await waitFor(() => {
      expect(screen.getByText(/failed to remove crop/i)).toBeInTheDocument();
    });

    globalThis.fetch = originalFetch;
  });

  it("disables save button while crop is saving", async () => {
    // Mock fetch to hang (never resolve) for the crop endpoint
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn((url: string, opts?: RequestInit) => {
      if (typeof url === "string" && url.includes("/crop") && opts?.method === "PUT") {
        return new Promise(() => {}); // never resolves
      }
      return originalFetch(url, opts);
    }) as typeof fetch;

    render(
      <MediaDetailModal media={mockPhoto} onClose={() => {}} onDelete={() => {}} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /add crop/i }));
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    // Save button should show "Saving..." and be disabled
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /saving/i })).toBeDisabled();
    });

    globalThis.fetch = originalFetch;
  });

  it("does not close editor when save fails (no optimistic UI)", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn((url: string, opts?: RequestInit) => {
      if (typeof url === "string" && url.includes("/crop") && opts?.method === "PUT") {
        return Promise.resolve(new Response("Internal Server Error", { status: 500 }));
      }
      return originalFetch(url, opts);
    }) as typeof fetch;

    render(
      <MediaDetailModal media={mockPhoto} onClose={() => {}} onDelete={() => {}} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /add crop/i }));
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() => {
      expect(screen.getByText(/failed to save crop/i)).toBeInTheDocument();
    });
    // Editor should still be open — Cancel button visible
    expect(screen.getByRole("button", { name: /cancel/i })).toBeInTheDocument();

    globalThis.fetch = originalFetch;
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `docker compose exec frontend npx vitest run MediaDetailModal`
Expected: FAIL

- [ ] **Step 3: Implement crop integration in MediaDetailModal**

In `frontend/src/components/MediaDetailModal.tsx`:

1. Import CropEditor and the api crop methods:
```typescript
import CropEditor from "./CropEditor";
import { api, modalVideoUrl, originalUrl, thumbnailUrl } from "../api/client";
```

2. Add state for crop editing mode and errors:
```typescript
const [cropEditing, setCropEditing] = useState(false);
const [cropError, setCropError] = useState<string | null>(null);
const [cropSaving, setCropSaving] = useState(false);
```

3. Reset crop editing state when media changes (add to existing useEffect):
```typescript
useEffect(() => {
  setImageLoaded(false);
  setJumpError(null);
  setCropEditing(false);
  setCropError(null);
}, [media?.id]);
```

4. Add crop action handlers:
```typescript
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
  try {
    await api.media.removeCrop(media.id);
  } catch {
    setCropError("Failed to remove crop");
  }
};
```

5. When `cropEditing` is true, replace the media area with the CropEditor:
```typescript
{cropEditing ? (
  <div className="flex-1 min-h-0">
    <CropEditor
      src={originalUrl(media)}
      imageWidth={media.width}
      imageHeight={media.height}
      initialCrop={
        media.crop_scale != null
          ? { crop_x: media.crop_x!, crop_y: media.crop_y!, crop_scale: media.crop_scale }
          : null
      }
      saving={cropSaving}
      onSave={handleSaveCrop}
      onCancel={() => setCropEditing(false)}
    />
  </div>
) : (
  /* existing media area */
)}
```

6. For the photo view mode (when not editing), add crop overlay when crop exists. In the photo rendering section (lines 278-297), wrap with crop visualization:
```typescript
{media.crop_scale != null ? (
  <div data-testid="crop-overlay" className="relative flex items-center justify-center w-full h-full">
    {/* Dimmed full image */}
    <img
      src={originalUrl(media)}
      alt=""
      className="max-w-full max-h-[70vh] object-contain brightness-[0.3]"
    />
    {/* Crop rectangle overlay — positioned via CSS to match crop data */}
    {/* The exact positioning CSS will use the crop_x, crop_y, crop_scale values */}
  </div>
) : (
  /* existing uncropped photo rendering */
)}
```

7. Add crop buttons to the header bar (after the jump-to-slideshow button), only for ready photos:
```typescript
{media.media_type === "photo" && isReady && !cropEditing && (
  <>
    {media.crop_scale != null ? (
      <>
        <button onClick={() => setCropEditing(true)} className="..." aria-label="Edit crop">
          {/* Crop icon SVG */}
        </button>
        <button onClick={handleRemoveCrop} className="..." aria-label="Remove crop">
          {/* X icon SVG */}
        </button>
      </>
    ) : (
      <button onClick={() => setCropEditing(true)} className="..." aria-label="Add crop">
        {/* Crop icon SVG */}
      </button>
    )}
  </>
)}
```

8. Show crop error banner (add near the other error banners):
```typescript
{cropError && (
  <div className="px-5 py-2 bg-red-500/10 border-b border-red-500/20">
    <p className="text-sm font-medium text-red-400">Error: {cropError}</p>
  </div>
)}
```

- [ ] **Step 4: Run tests**

Run: `docker compose exec frontend npx vitest run MediaDetailModal`
Expected: PASS

- [ ] **Step 5: Run full frontend test suite**

Run: `docker compose exec frontend npx vitest run`
Expected: All PASS

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/MediaDetailModal.tsx frontend/src/__tests__/MediaDetailModal.test.tsx
git commit -m "feat: integrate crop editor and crop overlay into gallery modal"
```

---

### Task 8: Visual QA with Playwright — verify crop renders correctly

**Files:**
- No new files — use ad-hoc Playwright scripts

This task verifies the crop feature end-to-end in the browser. Upload a test photo, set a crop via the API, then check the slideshow renders it correctly.

- [ ] **Step 1: Start the app**

Run: `docker compose up -d`

- [ ] **Step 2: Upload a test portrait photo and set a crop**

```bash
# Upload a tall portrait photo
docker compose exec backend python -c "
from PIL import Image
import io
img = Image.new('RGB', (600, 1200), color='blue')
# Add a distinctive red square in the upper third to verify crop targeting
from PIL import ImageDraw
draw = ImageDraw.Draw(img)
draw.rectangle([200, 150, 400, 350], fill='red')
buf = io.BytesIO()
img.save(buf, 'JPEG')
open('/tmp/portrait_test.jpg', 'wb').write(buf.getvalue())
"

# Upload via API
docker compose exec backend curl -s -X POST http://localhost:8000/api/media \
  -F "files=@/tmp/portrait_test.jpg" | python3 -c "import sys,json; m=json.load(sys.stdin)[0]; print(f'ID: {m[\"id\"]}')"
```

- [ ] **Step 3: Set crop via API to target the red square**

```bash
# Set crop centered on the red square (upper portion of portrait image)
docker compose exec backend curl -s -X PUT http://localhost:8000/api/media/1/crop \
  -H "Content-Type: application/json" \
  -d '{"crop_x": 0.5, "crop_y": 0.21, "crop_scale": 2.0}'
```

- [ ] **Step 4: Verify slideshow renders crop correctly with Playwright**

```bash
docker compose --profile test run --rm e2e node -e "
const { chromium } = require('@playwright/test');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1024, height: 600 } });
  await page.goto('http://frontend:5173/slideshow');
  await page.waitForSelector('img[data-media-id]', { timeout: 10000 });

  // Check that the foreground image has a transform applied
  const style = await page.locator('img[data-media-id]:not([aria-hidden])').getAttribute('style');
  console.log('Foreground img style:', style);

  // Take a screenshot for visual inspection
  await page.screenshot({ path: '/tmp/crop-slideshow.png' });
  console.log('Screenshot saved to /tmp/crop-slideshow.png');

  await browser.close();
})();
"
```

- [ ] **Step 5: Verify gallery modal shows crop overlay**

```bash
docker compose --profile test run --rm e2e node -e "
const { chromium } = require('@playwright/test');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  await page.goto('http://frontend:5173/');

  // Click on the first photo to open modal
  await page.locator('[data-testid=\"photo-card\"]').first().click();
  await page.waitForSelector('[data-testid=\"media-detail-modal\"]', { timeout: 5000 });

  // Check for crop overlay
  const hasOverlay = await page.locator('[data-testid=\"crop-overlay\"]').isVisible();
  console.log('Crop overlay visible:', hasOverlay);

  // Check for Edit Crop button
  const hasEditBtn = await page.locator('button[aria-label=\"Edit crop\"]').isVisible();
  console.log('Edit Crop button visible:', hasEditBtn);

  await page.screenshot({ path: '/tmp/crop-modal.png' });
  console.log('Screenshot saved to /tmp/crop-modal.png');

  await browser.close();
})();
"
```

- [ ] **Step 6: Fix any visual issues found**

If the crop transform doesn't look right (wrong position, wrong zoom, empty space visible), adjust the CSS math in the `Slide` component and `CropEditor` component. The coordinate system must be consistent between the editor (where the user sets the crop) and the slideshow (where it's rendered).

- [ ] **Step 7: Commit any fixes**

```bash
git add -u
git commit -m "fix: crop rendering adjustments from visual QA"
```

---

### Task 9: Run full test suite

**Files:** None — verification only

- [ ] **Step 1: Run backend tests**

Run: `./scripts/test-backend.sh`
Expected: All PASS

- [ ] **Step 2: Run frontend tests**

Run: `./scripts/test-frontend.sh`
Expected: All PASS

- [ ] **Step 3: Run E2E tests**

Run: `./scripts/test-e2e.sh`
Expected: All PASS (or existing failures unrelated to crop)

- [ ] **Step 4: Run all tests**

Run: `./scripts/test-all.sh`
Expected: All PASS
