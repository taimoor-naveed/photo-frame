import { useCallback, useEffect, useState } from "react";
import { api, type Media } from "../api/client";

export function usePhotos() {
  const [photos, setPhotos] = useState<Media[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
      const result = await api.media.upload(files);
      await fetchPhotos();
      return result;
    },
    [fetchPhotos],
  );

  const deletePhoto = useCallback(
    async (id: number) => {
      await api.media.delete(id);
      await fetchPhotos();
    },
    [fetchPhotos],
  );

  useEffect(() => {
    fetchPhotos();
  }, [fetchPhotos]);

  return { photos, total, loading, error, fetchPhotos, uploadFiles, deletePhoto };
}
