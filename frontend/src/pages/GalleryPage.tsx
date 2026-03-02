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

  // Clear modal selection if the selected media is removed (e.g. via WebSocket)
  useEffect(() => {
    if (selectedMedia && !photos.some((p) => p.id === selectedMedia.id)) {
      setSelectedMedia(null);
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
          <div key={i} className="aspect-[4/3] animate-pulse rounded-2xl bg-gray-200" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-20">
        <p className="text-red-500 mb-4">{error}</p>
        <button
          onClick={() => window.location.reload()}
          className="text-sm text-gray-500 hover:text-gray-700 underline underline-offset-4"
        >
          Retry
        </button>
      </div>
    );
  }

  if (photos.length === 0) {
    return (
      <div className="text-center py-20">
        <div className="inline-flex h-20 w-20 items-center justify-center rounded-2xl bg-gray-100 mb-6">
          <svg className="h-10 w-10 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
        </div>
        <h2 className="text-2xl font-semibold text-gray-900 mb-2">No photos yet</h2>
        <p className="text-gray-500 mb-8 max-w-sm mx-auto">
          Upload your first photos to get started with your photo frame.
        </p>
        <Link
          to="/upload"
          className="inline-flex items-center rounded-xl bg-gray-900 px-6 py-3 text-sm font-medium text-white shadow-sm hover:bg-gray-800 transition-colors"
        >
          Upload Photos
        </Link>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">
          Gallery
          <span className="ml-2 text-base font-normal text-gray-400">{total}</span>
        </h1>
        <Link
          to="/upload"
          className="rounded-xl bg-gray-900 px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-gray-800 transition-colors"
        >
          Upload
        </Link>
      </div>
      {deleteError && (
        <div className="mb-4 flex items-center justify-between rounded-xl bg-red-50 border border-red-200 px-4 py-3">
          <p className="text-sm font-medium text-red-700">{deleteError}</p>
          <button
            onClick={() => setDeleteError(null)}
            className="ml-4 text-red-400 hover:text-red-600 text-sm shrink-0"
          >
            Dismiss
          </button>
        </div>
      )}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {photos.map((media) => (
          <PhotoCard
            key={media.id}
            media={media}
            onClick={(m) => setSelectedMedia(m)}
            selectionMode={selectionMode}
            selected={selectedIds.has(media.id)}
            onLongPress={handleLongPress}
            onToggleSelect={handleToggleSelect}
          />
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
