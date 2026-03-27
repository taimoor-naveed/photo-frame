# Photo Crop for Slideshow

**Date:** 2026-03-28
**Status:** Approved

## Problem

Portrait photos on the 1024×600 landscape display waste screen space — the subject appears small with large blur margins. Users need a way to zoom into the interesting part of a photo for slideshow display.

## Scope

- Photos only (not videos)
- Frontend-only rendering — backend stores crop metadata, no image regeneration
- Crop is for slideshow display only — thumbnails, downloads, and gallery grid are unaffected

## Data Model

Three nullable Float columns on the `media` table:

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `crop_x` | Float | 0.0–1.0 | Horizontal offset of crop center as fraction of image width |
| `crop_y` | Float | 0.0–1.0 | Vertical offset of crop center as fraction of image height |
| `crop_scale` | Float | ≥1.0 | Zoom level (1.0 = image fits crop rectangle, >1.0 = zoomed in) |

A photo **has a crop** when `crop_scale is not None`. No crop = all three are None.

The crop rectangle aspect ratio is always 1024:600 (the display ratio), so dimensions are implicit — only position and zoom are stored.

## API

### Set/Update Crop

`PUT /api/media/{id}/crop`

```json
{"crop_x": 0.15, "crop_y": 0.22, "crop_scale": 1.8}
```

- Validates media exists and is a photo (not video) — returns 400 if video
- Validates all three fields present with Pydantic `Field(ge=0, le=1)` for x/y and `Field(ge=1)` for scale
- Saves to DB
- Broadcasts `media_updated` WebSocket event with full `MediaOut` payload

### Remove Crop

`DELETE /api/media/{id}/crop`

- Sets `crop_x`, `crop_y`, `crop_scale` to None
- Broadcasts `media_updated` WebSocket event

### Schema Change

`MediaOut` gains three optional fields:

```python
crop_x: float | None = None
crop_y: float | None = None
crop_scale: float | None = None
```

## Frontend: Gallery Modal (View Mode)

### Photo with crop set

- Full image shown dimmed (brightness ~30%)
- Crop region shown at full brightness within a 1024:600 aspect ratio rectangle outline
- The rectangle is positioned/zoomed according to `crop_x`, `crop_y`, `crop_scale`
- Buttons: **Edit Crop**, **Remove Crop**

### Photo without crop

- Image displays as it does today (no overlay)
- Button: **Add Crop**

### Videos

- No crop button shown — feature is photos only

## Frontend: Crop Editor (Edit Mode)

Activated by **Add Crop** or **Edit Crop**.

### Layout

- Fixed rectangle overlay at 1024:600 aspect ratio, centered in the modal
- Area outside the rectangle is dimmed
- Image visible at full brightness inside the rectangle

### Controls

- **Drag** (pointer/touch) to pan the image behind the fixed rectangle
- **Zoom slider** at the bottom (−/+ with draggable thumb) for precise zoom control
- **Pinch-to-zoom** supported as secondary gesture
- **Cancel** button — reverts to view mode, no API call
- **Save** button — computes `crop_x`, `crop_y`, `crop_scale` from current transform and calls `PUT /api/media/{id}/crop`

### Editing existing crop

When entering edit mode on a photo with an existing crop, the editor initializes with the saved position and zoom level so the user sees their current crop and can adjust from there.

### Constraints

- Image cannot be panned outside the rectangle (no empty space visible in crop)
- Minimum zoom: image must fill the crop rectangle entirely
- The crop rectangle never moves or resizes — only the image moves behind it

## Frontend: Slideshow

### Rendering (all photos, always)

Both layers always render (no conditional branching):

1. **Blur background**: `<img>` with `object-cover`, `scale(1.2)`, `blur(30px)`, `brightness(0.7)` — unchanged
2. **Foreground image**: `<img>` — if crop data exists, apply CSS `transform: scale(crop_scale) translate(...)` to show the cropped region. If no crop data, render with `object-contain` as today.

Since the crop rectangle matches the display aspect ratio, a cropped image fills the screen completely — the blur background is simply invisible behind it.

### Live update

When a `media_updated` WebSocket event is received:
- Update the media object in the playlist state
- If the updated media is the currently displayed slide, React re-renders with the new crop transform applied immediately (no slide transition, no flicker)

## What Doesn't Change

- Gallery grid thumbnails
- Download button (always serves original file)
- Video display
- Image processing pipeline (no regeneration of display/thumbnail files)
- Motion photos (detected as video, not affected)
- Upload flow

## Design Decisions

| Decision | Rationale |
|----------|-----------|
| Frontend-only crop | No image regeneration needed — CSS transforms are instant. Backend just stores metadata. Simpler pipeline, no storage overhead. |
| Three floats vs JSON blob | Pydantic validation with `Field()` constraints. No JSON parsing. Easier to query. |
| Fixed crop rectangle | Matches display aspect ratio exactly. User moves the image, not the rectangle. More intuitive on touch devices (iOS crop pattern). |
| Zoom slider + pinch | Slider provides precise control on desktop. Pinch is natural on mobile. Both work everywhere. |
| Blur layer always rendered | No conditional branching in slideshow. Cropped images fill the screen so blur is invisible. Simpler code. |
| `media_updated` WS event | Existing WS infrastructure. Crop changes appear live on the slideshow display without page refresh. |
