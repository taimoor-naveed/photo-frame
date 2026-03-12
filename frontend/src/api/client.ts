const API_BASE = "/api";

export interface Media {
  id: number;
  filename: string;
  original_name: string;
  media_type: "photo" | "video";
  width: number;
  height: number;
  file_size: number;
  duration: number | null;
  codec: string | null;
  thumb_filename: string;
  display_filename: string | null;
  processing_status: "processing" | "ready" | "error";
  processing_progress?: number; // 0-100, only during transcoding
  content_hash: string | null;
  uploaded_at: string;
}

export interface MediaList {
  items: Media[];
  total: number;
  page: number;
  per_page: number;
}

export interface Settings {
  slideshow_interval: number;
  transition_type: string;
}

export interface BulkDeleteResponse {
  deleted: number[];
  not_found: number[];
}

export interface SettingsUpdate {
  slideshow_interval?: number;
  transition_type?: string;
}

class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, options);
  if (!res.ok) {
    const text = await res.text().catch(() => "Request failed");
    throw new ApiError(res.status, text);
  }
  return res.json();
}

export const api = {
  media: {
    list(page = 1, perPage = 50): Promise<MediaList> {
      return request(`/media?page=${page}&per_page=${perPage}`);
    },
    get(id: number): Promise<Media> {
      return request(`/media/${id}`);
    },
    upload(
      files: File[],
      onProgress?: (percent: number) => void,
    ): Promise<Media[]> {
      const form = new FormData();
      for (const f of files) {
        form.append("files", f);
      }
      return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", `${API_BASE}/media`);
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable && onProgress) {
            onProgress(Math.round((e.loaded / e.total) * 100));
          }
        };
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve(JSON.parse(xhr.responseText));
          } else {
            reject(new ApiError(xhr.status, xhr.responseText || "Upload failed"));
          }
        };
        xhr.onerror = () => reject(new Error("Network error"));
        xhr.send(form);
      });
    },
    delete(id: number): Promise<void> {
      return request(`/media/${id}`, { method: "DELETE" });
    },
    async listAll(): Promise<Media[]> {
      const first = await this.list(1, 100);
      const items = [...first.items];
      const totalPages = Math.ceil(first.total / 100);
      for (let page = 2; page <= totalPages; page++) {
        const data = await this.list(page, 100);
        items.push(...data.items);
      }
      return items;
    },
    bulkDelete(ids: number[]): Promise<BulkDeleteResponse> {
      return request(`/media/bulk`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
    },
  },
  slideshow: {
    jump(mediaId: number): Promise<{ ok: boolean }> {
      return request("/media/slideshow/jump", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ media_id: mediaId }),
      });
    },
  },
  settings: {
    get(): Promise<Settings> {
      return request("/settings");
    },
    update(data: SettingsUpdate): Promise<Settings> {
      return request("/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
    },
  },
};

export function thumbnailUrl(media: Media): string {
  return `/uploads/thumbnails/${media.thumb_filename}`;
}

export function originalUrl(media: Media): string {
  return `/uploads/originals/${media.filename}`;
}

export function displayUrl(media: Media): string {
  if (media.display_filename) {
    return `/uploads/display/${media.display_filename}`;
  }
  return originalUrl(media);
}

const BROWSER_COMPATIBLE_CODECS = new Set(["h264", "vp8", "vp9", "av1"]);

/**
 * Best video URL for the gallery modal: original if browser-compatible, else transcoded display.
 */
export function modalVideoUrl(media: Media): string {
  if (media.codec && BROWSER_COMPATIBLE_CODECS.has(media.codec.toLowerCase())) {
    return originalUrl(media);
  }
  return displayUrl(media);
}
