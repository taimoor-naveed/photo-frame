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
  // Generation token: incremented on every reset (fetchPhotos).
  // fetchNextPage captures the token before its request and discards
  // the result if a reset happened while it was in flight.
  const generationRef = useRef(0);

  const fetchPhotos = useCallback(async () => {
    generationRef.current++;
    // Clear any in-flight fetchNextPage state so the spinner disappears
    // and the observer can resume after the reset completes
    loadingMoreRef.current = false;
    setLoadingMore(false);
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

  // Each fetchNextPage call gets a unique ID so stale finally blocks
  // don't clear state that belongs to a newer request.
  const loadMoreRequestIdRef = useRef(0);

  const fetchNextPage = useCallback(async () => {
    if (loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    const gen = generationRef.current;
    const requestId = ++loadMoreRequestIdRef.current;
    try {
      const nextPage = pageRef.current + 1;
      const data = await api.media.list(nextPage, PER_PAGE);
      // Discard if a reset happened while this request was in flight
      if (gen !== generationRef.current) return;
      pageRef.current = nextPage;
      setPhotos((prev) => [...prev, ...data.items]);
      setTotal(data.total);
      setHasMore(nextPage * PER_PAGE < data.total);
    } catch (e) {
      if (gen !== generationRef.current) return;
      setError(e instanceof Error ? e.message : "Failed to load media");
    } finally {
      // Only clear if this is still the latest request — a stale
      // finally must not clobber state owned by a newer request.
      if (requestId === loadMoreRequestIdRef.current) {
        loadingMoreRef.current = false;
        setLoadingMore(false);
      }
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
