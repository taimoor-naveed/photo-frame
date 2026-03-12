# Pagination: Gallery UI + Slideshow Fetch-All

## Problem

The backend caps `per_page` at 100, but:
- The slideshow requests `per_page=1000` — silently truncated to 100, so items beyond 100 never appear
- The gallery uses `per_page=50` (page 1 only) — no way to see items beyond 50

## Solution

Two different strategies for two different use cases:

1. **Gallery** — paginated UI with 100 items per page, prev/next controls
2. **Slideshow** — multi-page fetch to load all items into memory (metadata only, ~200 bytes per item)

## Gallery: Paginated UI

### `usePhotos` hook changes
- Add state: `page` (default 1), constant `perPage = 100`
- Derive `totalPages` from `Math.ceil(total / perPage)`
- Keep `fetchPhotos` accepting a page argument internally, but the default is the current `page` state
- Use `fetchPhotosRef` (ref pattern) so `handleWsEvent` can call the latest fetch without adding it to `useCallback` deps — this prevents WS reconnects (per CLAUDE.md: "Never add deps to `handleWsEvent`'s `useCallback`")
- Expose: `page`, `totalPages`, `goToPage(n: number)`
- `goToPage` sets page state, triggers refetch
- After successful upload, reset to page 1 so the user sees their new item
- WebSocket `media_added` / `media_deleted`: refetch current page via ref. If current page becomes empty (all items deleted), step back to `page - 1` (minimum 1)

### New component: `Pagination.tsx`
- Props: `page: number`, `totalPages: number`, `onPageChange: (page: number) => void`
- Renders: `Previous` button | `Page X of Y` text | `Next` button
- Previous disabled when `page === 1`, Next disabled when `page === totalPages`
- Dark theme styling consistent with existing UI, 44px minimum touch targets
- Hidden when `totalPages <= 1`

### `GalleryPage.tsx` changes
- Import and render `Pagination` below the media grid
- On page change, scroll to top via `window.scrollTo({ top: 0, behavior: 'smooth' })`

## Slideshow: Fetch All

### `api/client.ts` — new `listAll()` method
```typescript
async listAll(): Promise<Media[]> {
  const first = await this.list(1, 100);
  const items = [...first.items];
  if (first.total <= 100) return items;

  const totalPages = Math.ceil(first.total / 100);
  const remaining = await Promise.all(
    Array.from({ length: totalPages - 1 }, (_, i) => this.list(i + 2, 100))
  );
  for (const page of remaining) {
    items.push(...page.items);
  }
  return items;
}
```

Race condition note: if items are added/deleted between page fetches, results may have duplicates or gaps. This is acceptable — low traffic, metadata only, and WS events will trigger a correction shortly after.

### `SlideshowPage.tsx` changes
- Replace `api.media.list(1, 1000)` with `api.media.listAll()` for initial load only
- WebSocket handlers (`media_added`, `media_deleted`, `media_processing_complete`) keep their existing surgical insert/remove behavior — they do NOT refetch. This preserves shuffle order and current slide position.

## Backend

No changes. The 100-item `per_page` cap and existing pagination logic are correct.

## Files changed

| File | Change |
|------|--------|
| `frontend/src/api/client.ts` | Add `listAll()` method |
| `frontend/src/hooks/usePhotos.ts` | Add page state, `goToPage`, `fetchPhotosRef`, derive `totalPages` |
| `frontend/src/components/Pagination.tsx` | New component |
| `frontend/src/pages/GalleryPage.tsx` | Wire up `Pagination` component |
| `frontend/src/pages/SlideshowPage.tsx` | Switch initial load to `listAll()` |
| `frontend/src/__tests__/GalleryPage.test.tsx` | Add pagination tests |
| `frontend/src/__tests__/SlideshowPage.test.tsx` | Update mocks for multi-page fetch |
| New: `frontend/src/__tests__/Pagination.test.tsx` | Unit tests for Pagination component |

## Edge cases

- **Delete last item on last page**: step back to previous page
- **Only one page of results**: hide pagination controls
- **Empty library**: no pagination shown (existing empty state handles this)
- **Upload while on page > 1**: reset to page 1 after successful upload
- **WebSocket media_added while on page 1**: refetch shows new item (newest first ordering)
- **WebSocket media_added while on page 2+**: refetch current page (item appears on page 1, current page shifts)
- **listAll() race condition**: acceptable — WS events correct any inconsistency

## Key tests to add

- Gallery: page navigation (next/prev), pagination hidden when <= 1 page
- Gallery: WS delete on last page with one item steps back to previous page
- Gallery: WS add while on page > 1 stays on current page
- Gallery: upload resets to page 1
- Slideshow: multi-page fetch combines all items
- Slideshow: WS handlers still do surgical updates (no refetch)
- Pagination component: disabled states, hidden when single page
