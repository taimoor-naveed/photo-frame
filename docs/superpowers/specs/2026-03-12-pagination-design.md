# Fix: Raise per_page cap for home photo frame

## Problem

The backend caps `per_page` at 100, but the slideshow requests `per_page=1000` — silently truncated to 100, so items beyond 100 never appear in the slideshow. The gallery defaults to 50 items and has no way to show more.

## Solution

Raise the backend `per_page` cap to 10,000 and have both gallery and slideshow request all items in one call. No pagination UI needed — this is a home photo frame with a small library.

## Changes

| File | Change |
|------|--------|
| `backend/app/routers/media.py` | Change `per_page > 100` cap to `per_page > 10000` |
| `frontend/src/hooks/usePhotos.ts` | `fetchPhotos` calls `api.media.list(1, 10000)` |
| `frontend/src/pages/SlideshowPage.tsx` | Change `api.media.list(1, 1000)` to `api.media.list(1, 10000)` |
| `frontend/src/__tests__/SlideshowPage.test.tsx` | Update mocks from `per_page: 1000` to `per_page: 10000` |
| `frontend/src/__tests__/GalleryPage.test.tsx` | Update mocks from `per_page: 50` to `per_page: 10000` |
| `frontend/src/__tests__/usePhotos.test.ts` | Update mocks if they reference `per_page: 50` |

## Backend validation after change

`per_page` range: 1–10,000 (was 1–100). Everything else unchanged.
