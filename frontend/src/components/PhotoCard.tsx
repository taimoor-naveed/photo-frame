import { useState } from "react";
import type { Media } from "../api/client";
import { thumbnailUrl } from "../api/client";
import ConfirmDialog from "./ConfirmDialog";

interface PhotoCardProps {
  media: Media;
  onDelete: (id: number) => void;
}

export default function PhotoCard({ media, onDelete }: PhotoCardProps) {
  const [confirmOpen, setConfirmOpen] = useState(false);

  return (
    <>
      <div data-testid="photo-card" className="group relative overflow-hidden rounded-2xl bg-gray-100 shadow-sm hover:shadow-md transition-shadow">
        <div className="aspect-[4/3]">
          <img
            src={thumbnailUrl(media)}
            alt={media.original_name}
            className="h-full w-full object-cover"
            loading="lazy"
          />
        </div>

        {/* Media type badge */}
        {media.media_type === "video" && (
          <div className="absolute top-2.5 left-2.5 rounded-lg bg-black/60 backdrop-blur-sm px-2 py-1 text-xs font-medium text-white">
            Video
          </div>
        )}

        {/* Hover overlay */}
        <div className="absolute inset-0 flex flex-col justify-end bg-gradient-to-t from-black/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
          <div className="flex items-center justify-between p-3">
            <span className="truncate text-sm text-white/90 mr-2">
              {media.original_name}
            </span>
            <button
              onClick={() => setConfirmOpen(true)}
              className="shrink-0 rounded-lg bg-white/20 backdrop-blur-sm p-2 text-white hover:bg-red-600 transition-colors"
              aria-label={`Delete ${media.original_name}`}
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title="Delete media"
        message={`Are you sure you want to delete "${media.original_name}"? This cannot be undone.`}
        onConfirm={() => {
          setConfirmOpen(false);
          onDelete(media.id);
        }}
        onCancel={() => setConfirmOpen(false)}
      />
    </>
  );
}
