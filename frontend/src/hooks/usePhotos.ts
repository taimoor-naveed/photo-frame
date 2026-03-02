import { useCallback, useEffect, useState } from "react";
import { api, type Media } from "../api/client";
import { useWebSocket, type WsEvent } from "./useWebSocket";

export function usePhotos() {
  const [photos, setPhotos] = useState<Media[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);

  const fetchPhotos = useCallback(async (page = 1) => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.media.list(page);
      setPhotos(data.items);
      setTotal(data.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load media");
    } finally {
      setLoading(false);
    }
  }, []);

  const uploadFiles = useCallback(
    async (files: File[]) => {
      setUploadProgress(0);
      try {
        const result = await api.media.upload(files, (pct) => setUploadProgress(pct));
        await fetchPhotos();
        return result;
      } finally {
        setUploadProgress(null);
      }
    },
    [fetchPhotos],
  );

  const [deleteError, setDeleteError] = useState<string | null>(null);

  const deletePhoto = useCallback(
    async (id: number) => {
      setDeleteError(null);
      try {
        await api.media.delete(id);
        await fetchPhotos();
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Failed to delete";
        setDeleteError(msg);
        throw e;
      }
    },
    [fetchPhotos],
  );

  const bulkDeletePhotos = useCallback(
    async (ids: number[]) => {
      setDeleteError(null);
      try {
        await api.media.bulkDelete(ids);
        await fetchPhotos();
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Failed to delete";
        setDeleteError(msg);
        throw e;
      }
    },
    [fetchPhotos],
  );

  // Live updates via WebSocket
  const handleWsEvent = useCallback(
    (event: WsEvent) => {
      if (event.type === "media_added" || event.type === "media_deleted") {
        fetchPhotos();
      } else if (event.type === "media_processing_progress") {
        const { id, progress } = event.payload as { id: number; progress: number };
        setPhotos((prev) =>
          prev.map((p) =>
            p.id === id ? { ...p, processing_progress: progress } : p,
          ),
        );
      } else if (event.type === "media_processing_complete") {
        // Update the specific media item in-place
        const updated = event.payload as unknown as Media;
        setPhotos((prev) =>
          prev.map((p) => (p.id === updated.id ? updated : p)),
        );
      } else if (event.type === "media_processing_error") {
        const { id } = event.payload as { id: number };
        setPhotos((prev) =>
          prev.map((p) =>
            p.id === id ? { ...p, processing_status: "error" as const } : p,
          ),
        );
      }
    },
    [fetchPhotos],
  );

  useWebSocket({ onEvent: handleWsEvent });

  useEffect(() => {
    fetchPhotos();
  }, [fetchPhotos]);

  return { photos, total, loading, error, deleteError, setDeleteError, uploadProgress, fetchPhotos, uploadFiles, deletePhoto, bulkDeletePhotos };
}
