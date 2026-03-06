import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { Media } from "../api/client";
import MediaDetailModal from "../components/MediaDetailModal";
import PhotoCard from "../components/PhotoCard";
import SelectionActionBar from "../components/SelectionActionBar";
import { usePhotos } from "../hooks/usePhotos";

export default function GalleryPage() {
  const { photos, total, loading, error, deleteError, setDeleteError, deletePhoto, bulkDeletePhotos } = usePhotos();
  const [selectedMedia, setSelectedMedia] = useState<Media | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  // Sync modal selection with latest photo data (e.g. processing progress via WebSocket)
  useEffect(() => {
    if (!selectedMedia) return;
    const updated = photos.find((p) => p.id === selectedMedia.id);
    if (!updated) {
      setSelectedMedia(null);
    } else if (updated !== selectedMedia) {
      setSelectedMedia(updated);
    }
  }, [photos, selectedMedia]);

  // Prune stale IDs from selection when photos change (WS deletions)
  useEffect(() => {
    if (!selectionMode) return;
    const photoIds = new Set(photos.map((p) => p.id));
    setSelectedIds((prev) => {
      const pruned = new Set([...prev].filter((id) => photoIds.has(id)));
      if (pruned.size === prev.size) return prev;
      return pruned;
    });
    // Auto-exit selection mode if no photos remain
    if (photos.length === 0) {
      setSelectionMode(false);
      setSelectedIds(new Set());
    }
  }, [photos, selectionMode]);

  // Escape key exits selection mode
  useEffect(() => {
    if (!selectionMode) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setSelectionMode(false);
        setSelectedIds(new Set());
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [selectionMode]);

  const handleLongPress = useCallback((media: Media) => {
    setSelectionMode(true);
    setSelectedIds(new Set([media.id]));
  }, []);

  const handleToggleSelect = useCallback((media: Media) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(media.id)) {
        next.delete(media.id);
      } else {
        next.add(media.id);
      }
      return next;
    });
  }, []);

  const handleSelectAll = useCallback(() => {
    setSelectedIds(new Set(photos.map((p) => p.id)));
  }, [photos]);

  const handleDeselectAll = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const handleCancelSelection = useCallback(() => {
    setSelectionMode(false);
    setSelectedIds(new Set());
  }, []);

  const handleBulkDelete = useCallback(async () => {
    const ids = [...selectedIds];
    try {
      await bulkDeletePhotos(ids);
      setSelectionMode(false);
      setSelectedIds(new Set());
    } catch {
      // Error state is set by usePhotos — keep selection mode active
    }
  }, [selectedIds, bulkDeletePhotos]);

  if (loading) {
    return (
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="aspect-[4/3] animate-pulse rounded-2xl bg-surface" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-20">
        <div className="inline-block rounded-2xl bg-red-500/10 border border-red-500/20 px-8 py-6">
          <p className="text-red-400 mb-4">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="text-sm text-warm-gray hover:text-warm-white underline underline-offset-4"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (photos.length === 0) {
    return (
      <div className="text-center py-20">
        <div className="inline-flex h-20 w-20 items-center justify-center rounded-2xl bg-surface mb-6">
          <svg className="h-10 w-10 text-warm-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
        </div>
        <h2 className="font-display text-3xl text-warm-white mb-3">Your gallery awaits</h2>
        <p className="text-warm-gray mb-8 max-w-sm mx-auto">
          Upload your first photos to bring this space to life.
        </p>
        <Link
          to="/upload"
          className="inline-flex items-center gap-2 rounded-xl bg-copper px-6 py-3 text-sm font-semibold text-ink hover:bg-copper-light transition-colors"
        >
          Upload Photos
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M14 5l7 7m0 0l-7 7m7-7H3" />
          </svg>
        </Link>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <h1 className="font-display text-3xl text-warm-white">
          Gallery
          <span className="ml-3 text-lg font-sans font-normal text-warm-muted">{total}</span>
        </h1>
        <Link
          to="/upload"
          className="rounded-xl bg-copper px-4 py-2.5 text-sm font-semibold text-ink hover:bg-copper-light transition-colors"
        >
          Upload
        </Link>
      </div>
      {deleteError && (
        <div className="mb-4 flex items-center justify-between rounded-xl bg-red-500/10 border border-red-500/20 px-4 py-3">
          <p className="text-sm font-medium text-red-400">{deleteError}</p>
          <button
            onClick={() => setDeleteError(null)}
            className="ml-4 text-red-400 hover:text-red-300 text-sm shrink-0"
          >
            Dismiss
          </button>
        </div>
      )}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {photos.map((media, i) => (
          <div
            key={media.id}
            className="animate-fade-in-up"
            style={{ animationDelay: `${Math.min(i, 11) * 60}ms` }}
          >
            <PhotoCard
              media={media}
              onClick={(m) => setSelectedMedia(m)}
              selectionMode={selectionMode}
              selected={selectedIds.has(media.id)}
              onLongPress={handleLongPress}
              onToggleSelect={handleToggleSelect}
            />
          </div>
        ))}
      </div>

      {selectionMode && (
        <SelectionActionBar
          selectedCount={selectedIds.size}
          totalCount={photos.length}
          onCancel={handleCancelSelection}
          onSelectAll={handleSelectAll}
          onDeselectAll={handleDeselectAll}
          onDelete={handleBulkDelete}
        />
      )}

      <MediaDetailModal
        media={selectedMedia}
        onClose={() => { setSelectedMedia(null); setDeleteError(null); }}
        onDelete={async (id) => {
          try {
            await deletePhoto(id);
            setSelectedMedia(null);
          } catch {
            // Error state is set by usePhotos — keep modal open
          }
        }}
        error={deleteError}
      />
    </div>
  );
}
