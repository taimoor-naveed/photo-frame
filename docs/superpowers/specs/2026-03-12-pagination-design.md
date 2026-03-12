# Fix: Infinite Scroll Gallery + Slideshow Fetch-All

## Problem

The backend caps `per_page` at 100, but:
- The slideshow requests `per_page=1000` — silently truncated to 100, so items beyond 100 never appear
- The gallery uses `per_page=50` (page 1 only) — no way to see items beyond 50

## Solution

Two different strategies for two different use cases:

1. **Gallery** — infinite scroll: load 50 items at a time, fetch more as the user scrolls near the bottom
2. **Slideshow** — multi-page fetch (`listAll()`) to load all items into memory (metadata only, ~200 bytes per item)

## Gallery: Infinite Scroll

### `usePhotos` hook changes
- Add state: `page` (tracks next page to fetch), `hasMore` (whether more pages exist)
- `photos` array accumulates across pages (append, not replace)
- `fetchPhotos()` fetches page 1 (initial load), replaces array — used by WS events and upload
- New `fetchNextPage()` — appends next page of results to existing array, increments `page`, sets `hasMore = false` when all loaded
- Use `fetchPhotosRef` (ref pattern) so `handleWsEvent` can call fetch without being in `useCallback` deps — prevents WS reconnects
- Expose: `hasMore`, `fetchNextPage`, `loadingMore` (separate from initial `loading`)
- After upload: reset to page 1 (refetch from scratch so new item appears at top)
- WS `media_added` / `media_deleted`: refetch from page 1 (reset accumulated list)

### `GalleryPage.tsx` changes
- Add a sentinel `<div>` at the bottom of the grid
- Use `IntersectionObserver` on the sentinel — when visible, call `fetchNextPage()`
- Show a small spinner at the bottom while `loadingMore` is true
- No other UI changes — grid looks the same, items just keep appearing as you scroll

### `api/client.ts` — no changes for gallery
Gallery uses `api.media.list(page, 50)` as before, just calls it repeatedly.

## Slideshow: Fetch All

### `api/client.ts` — new `listAll()` method
```typescript
async listAll(): Promise<Media[]> {
  const first = await this.list(1, 100);
  const items = [...first.items];
  const totalPages = Math.ceil(first.total / 100);
  for (let page = 2; page <= totalPages; page++) {
    const data = await this.list(page, 100);
    items.push(...data.items);
  }
  return items;
}
```

Sequential fetching (not `Promise.all`) to avoid hammering the backend with unbounded parallel requests at scale. Race condition note: if items are added/deleted between page fetches, results may have duplicates or gaps. Acceptable — low traffic, metadata only, WS events correct it.

### `SlideshowPage.tsx` changes
- Replace `api.media.list(1, 1000)` with `api.media.listAll()` for initial load only
- WS handlers keep existing surgical insert/remove behavior (preserves shuffle + position)

## Backend

No changes. The 100-item `per_page` cap stays.

## Files changed

| File | Change |
|------|--------|
| `frontend/src/api/client.ts` | Add `listAll()` method |
| `frontend/src/hooks/usePhotos.ts` | Add infinite scroll state (`page`, `hasMore`, `fetchNextPage`, `loadingMore`), ref pattern for WS |
| `frontend/src/pages/GalleryPage.tsx` | Add IntersectionObserver sentinel + loading spinner |
| `frontend/src/pages/SlideshowPage.tsx` | Switch initial load to `listAll()` |
| `frontend/src/__tests__/GalleryPage.test.tsx` | Add infinite scroll tests |
| `frontend/src/__tests__/usePhotos.test.ts` | Add `fetchNextPage` tests |
| `frontend/src/__tests__/SlideshowPage.test.tsx` | Update mocks for `listAll()` |
| `e2e/fixtures/base.ts` | Update cleanup helpers to paginate through all items |

## Edge cases

- **Fewer than 50 items**: single fetch, `hasMore = false`, no sentinel trigger
- **Exact multiple of 50**: last fetch returns empty page, sets `hasMore = false`
- **WS media_added/deleted during scroll**: reset to page 1, refetch from scratch
- **Upload while scrolled down**: reset to page 1 so new item is visible at top
- **Rapid scroll**: guard against concurrent `fetchNextPage` calls (skip if already `loadingMore`)
- **listAll() race condition**: acceptable — WS events correct any inconsistency

## Key tests to add

- Gallery: initial load fetches page 1 with 50 items
- Gallery: `fetchNextPage` appends items and increments page
- Gallery: `hasMore = false` when all items loaded
- Gallery: WS delete/add resets to page 1
- Gallery: no concurrent `fetchNextPage` calls
- Slideshow: `listAll()` combines multiple pages
- Slideshow: WS handlers still do surgical updates (no refetch)
