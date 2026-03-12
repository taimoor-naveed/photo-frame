import { useCallback, useEffect, useRef, useState } from "react";
import { api, type Media } from "../api/client";
import { useWebSocket, type WsEvent } from "./useWebSocket";

const PER_PAGE = 50;

export function usePhotos() {
  const [photos, setPhotos] = useState<Media[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const loadingMoreRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const pageRef = useRef(1);

  const fetchPhotos = useCallback(async () => {
    setLoading(true);
    setError(null);
    pageRef.current = 1;
    try {
      const data = await api.media.list(1, PER_PAGE);
      setPhotos(data.items);
      setTotal(data.total);
      setHasMore(data.items.length < data.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load media");
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchNextPage = useCallback(async () => {
    if (loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      const nextPage = pageRef.current + 1;
      const data = await api.media.list(nextPage, PER_PAGE);
      pageRef.current = nextPage;
      setPhotos((prev) => [...prev, ...data.items]);
      setTotal(data.total);
      setHasMore(nextPage * PER_PAGE < data.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load media");
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, []);

  // Ref pattern so WS handler can call latest fetchPhotos without dep
  const fetchPhotosRef = useRef(fetchPhotos);
  useEffect(() => { fetchPhotosRef.current = fetchPhotos; }, [fetchPhotos]);

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
        await fetchPhotosRef.current();
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Failed to delete";
        setDeleteError(msg);
        throw e;
      }
    },
    [],
  );

  const bulkDeletePhotos = useCallback(
    async (ids: number[]) => {
      setDeleteError(null);
      try {
        await api.media.bulkDelete(ids);
        await fetchPhotosRef.current();
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Failed to delete";
        setDeleteError(msg);
        throw e;
      }
    },
    [],
  );

  // Live updates via WebSocket
  const handleWsEvent = useCallback(
    (event: WsEvent) => {
      if (event.type === "media_added" || event.type === "media_deleted") {
        fetchPhotosRef.current();
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
    [],
  );

  useWebSocket({ onEvent: handleWsEvent });

  useEffect(() => {
    fetchPhotos();
  }, [fetchPhotos]);

  return { photos, total, loading, loadingMore, hasMore, error, deleteError, setDeleteError, uploadProgress, fetchPhotos, fetchNextPage, uploadFiles, deletePhoto, bulkDeletePhotos };
}
