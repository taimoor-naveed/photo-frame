import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api, originalUrl, type Media, type Settings } from "../api/client";
import { useWebSocket, type WsEvent } from "../hooks/useWebSocket";
import { useGestures } from "../hooks/useGestures";
import SlideshowOverlay from "../components/SlideshowOverlay";

export default function SlideshowPage() {
  const [mediaList, setMediaList] = useState<Media[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [prevIndex, setPrevIndex] = useState<number | null>(null);
  const [paused, setPaused] = useState(false);
  const [overlayVisible, setOverlayVisible] = useState(false);

  const hideTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const advanceTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const videoRef = useRef<HTMLVideoElement>(null);
  const prevVideoRef = useRef<HTMLVideoElement>(null);

  // ─── Data fetching ───────────────────────────────────────────

  const fetchData = useCallback(async () => {
    try {
      const [mediaRes, settingsRes] = await Promise.all([
        api.media.list(1, 1000),
        api.settings.get(),
      ]);
      setMediaList(mediaRes.items);
      setSettings(settingsRes);
    } catch {
      // Retry after 5s on failure
      setTimeout(fetchData, 5000);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // ─── Ordered playlist ────────────────────────────────────────

  const playlist = useMemo(() => {
    if (!mediaList.length || !settings) return [];
    const items = [...mediaList];
    if (settings.photo_order === "random") {
      // Fisher-Yates shuffle
      for (let i = items.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [items[i], items[j]] = [items[j], items[i]];
      }
    } else if (settings.photo_order === "newest") {
      items.sort(
        (a, b) =>
          new Date(b.uploaded_at).getTime() -
          new Date(a.uploaded_at).getTime(),
      );
    }
    // 'sequential' keeps original order (by ID)
    return items;
  }, [mediaList, settings]);

  const currentMedia = playlist[currentIndex] ?? null;
  const prevMedia =
    prevIndex !== null ? playlist[prevIndex] ?? null : null;

  // ─── Navigation ──────────────────────────────────────────────

  const goToSlide = useCallback(
    (next: number) => {
      if (!playlist.length) return;
      setPrevIndex(currentIndex);
      setCurrentIndex(next);
      // Clear previous slide after transition
      setTimeout(() => setPrevIndex(null), 600);
    },
    [currentIndex, playlist.length],
  );

  const goNext = useCallback(() => {
    if (!playlist.length) return;
    goToSlide((currentIndex + 1) % playlist.length);
  }, [currentIndex, playlist.length, goToSlide]);

  const goPrev = useCallback(() => {
    if (!playlist.length) return;
    goToSlide((currentIndex - 1 + playlist.length) % playlist.length);
  }, [currentIndex, playlist.length, goToSlide]);

  // ─── Auto-advance timer ──────────────────────────────────────

  useEffect(() => {
    clearTimeout(advanceTimer.current);
    if (paused || !settings || !playlist.length) return;

    advanceTimer.current = setTimeout(
      goNext,
      settings.slideshow_interval * 1000,
    );
    return () => clearTimeout(advanceTimer.current);
  }, [currentIndex, paused, settings, playlist.length, goNext]);

  // ─── Overlay auto-hide ──────────────────────────────────────

  useEffect(() => {
    if (!overlayVisible) return;
    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setOverlayVisible(false), 5000);
    return () => clearTimeout(hideTimer.current);
  }, [overlayVisible, settings]);

  // Reset hide timer when settings change (user is interacting)
  const handleUpdateSettings = useCallback(
    async (update: Parameters<typeof api.settings.update>[0]) => {
      // Reset the auto-hide timer
      clearTimeout(hideTimer.current);
      hideTimer.current = setTimeout(() => setOverlayVisible(false), 5000);

      try {
        const updated = await api.settings.update(update);
        setSettings(updated);
      } catch {
        // Silently fail — overlay will show stale value
      }
    },
    [],
  );

  // ─── WebSocket ───────────────────────────────────────────────

  const handleWsEvent = useCallback(
    (event: WsEvent) => {
      if (event.type === "media_added" || event.type === "media_deleted") {
        // Refetch media list
        api.media.list(1, 1000).then((res) => {
          setMediaList(res.items);
          // If current index is out of bounds, reset
          if (currentIndex >= res.items.length) {
            setCurrentIndex(0);
          }
        });
      } else if (event.type === "settings_changed") {
        setSettings(event.payload as unknown as Settings);
      }
    },
    [currentIndex],
  );

  useWebSocket({ onEvent: handleWsEvent });

  // ─── Gestures ────────────────────────────────────────────────

  const { bind } = useGestures({
    onSwipeLeft: goNext,
    onSwipeRight: goPrev,
    onTap: () => setOverlayVisible((v) => !v),
    onLongPress: () => setPaused((p) => !p),
  });

  // Gesture bind returns handler props from useDrag

  // ─── Keyboard support ────────────────────────────────────────

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") goNext();
      else if (e.key === "ArrowLeft") goPrev();
      else if (e.key === " ") {
        e.preventDefault();
        setPaused((p) => !p);
      } else if (e.key === "Escape") setOverlayVisible(false);
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [goNext, goPrev]);

  // ─── Preload next image ──────────────────────────────────────

  useEffect(() => {
    if (!playlist.length) return;
    const nextIdx = (currentIndex + 1) % playlist.length;
    const nextMedia = playlist[nextIdx];
    if (nextMedia?.media_type === "photo") {
      const img = new Image();
      img.src = originalUrl(nextMedia);
    }
  }, [currentIndex, playlist]);

  // ─── Render ──────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-white/30 border-t-white rounded-full animate-spin" />
      </div>
    );
  }

  if (!playlist.length) {
    return (
      <div className="fixed inset-0 bg-black flex items-center justify-center">
        <div className="text-center">
          <p className="text-white/60 text-lg mb-4">No photos to display</p>
          <Link
            to="/upload"
            className="text-white/80 hover:text-white text-sm underline underline-offset-4 transition-colors"
          >
            Upload photos to start slideshow
          </Link>
        </div>
      </div>
    );
  }

  const transitionClass =
    settings?.transition_type === "crossfade"
      ? "transition-opacity duration-500 ease-in-out"
      : settings?.transition_type === "slide"
        ? "transition-all duration-500 ease-in-out"
        : "";

  return (
    <div
      {...bind()}
      className="fixed inset-0 bg-black select-none touch-none overflow-hidden"
      style={{ cursor: overlayVisible ? "auto" : "none" }}
    >
      {/* Previous slide (fading out) */}
      {prevMedia && (
        <div className="absolute inset-0 z-0">
          <Slide media={prevMedia} videoRef={prevVideoRef} />
        </div>
      )}

      {/* Current slide */}
      <div
        className={`absolute inset-0 z-10 ${transitionClass}`}
        style={{
          opacity: prevMedia && settings?.transition_type === "crossfade" ? 1 : undefined,
        }}
      >
        <Slide media={currentMedia!} videoRef={videoRef} />
      </div>

      {/* Pause indicator */}
      {paused && !overlayVisible && (
        <div className="absolute top-6 right-6 z-20 bg-black/50 backdrop-blur-sm rounded-full px-3 py-1.5 text-white/80 text-xs font-medium">
          Paused
        </div>
      )}

      {/* Overlay */}
      {settings && (
        <SlideshowOverlay
          visible={overlayVisible}
          settings={settings}
          paused={paused}
          onTogglePause={() => setPaused((p) => !p)}
          onUpdateSettings={handleUpdateSettings}
        />
      )}
    </div>
  );
}

// ─── Slide component ─────────────────────────────────────────

interface SlideProps {
  media: Media;
  videoRef?: React.RefObject<HTMLVideoElement | null>;
}

function Slide({ media, videoRef }: SlideProps) {
  const src = originalUrl(media);

  if (media.media_type === "video") {
    return (
      <>
        {/* Blur background */}
        <video
          src={src}
          className="absolute inset-0 w-full h-full object-cover scale-[1.2] blur-[30px] brightness-[0.7]"
          muted
          autoPlay
          aria-hidden="true"
        />
        {/* Foreground video */}
        <video
          ref={videoRef}
          src={src}
          className="absolute inset-0 w-full h-full object-contain"
          muted
          autoPlay
        />
      </>
    );
  }

  return (
    <>
      {/* Blur background */}
      <img
        src={src}
        className="absolute inset-0 w-full h-full object-cover scale-[1.2] blur-[30px] brightness-[0.7]"
        alt=""
        aria-hidden="true"
      />
      {/* Foreground image */}
      <img
        src={src}
        className="absolute inset-0 w-full h-full object-contain"
        alt={media.original_name}
      />
    </>
  );
}
