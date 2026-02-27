import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api, originalUrl, thumbnailUrl, type Media, type Settings } from "../api/client";
import { useWebSocket, type WsEvent } from "../hooks/useWebSocket";
import SlideshowOverlay from "../components/SlideshowOverlay";

export default function SlideshowPage() {
  const [mediaList, setMediaList] = useState<Media[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [prevIndex, setPrevIndex] = useState<number | null>(null);
  const [transitioning, setTransitioning] = useState(false);
  const [paused, setPaused] = useState(false);
  const [overlayVisible, setOverlayVisible] = useState(false);

  const hideTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const advanceTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const videoRef = useRef<HTMLVideoElement>(null);
  const prevVideoRef = useRef<HTMLVideoElement>(null);
  const waitingForVideo = useRef(false);
  const longPressTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const didLongPress = useRef(false);

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

  // ─── Ordered playlist (only ready media) ───────────────────

  const playlist = useMemo(() => {
    if (!mediaList.length || !settings) return [];
    // Filter out videos that aren't ready
    const ready = mediaList.filter(
      (m) => m.media_type === "photo" || m.processing_status === "ready",
    );
    const items = [...ready];
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
      waitingForVideo.current = false;
      setPrevIndex(currentIndex);
      setCurrentIndex(next);
      setTransitioning(true);
      // Double rAF: first ensures the DOM renders with transitioning=true (opacity 0),
      // second triggers the CSS transition to opacity 1
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setTransitioning(false);
        });
      });
      // Clear previous slide after transition completes
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
    waitingForVideo.current = false;
    if (paused || !settings || !playlist.length) return;

    const media = playlist[currentIndex];
    const interval = settings.slideshow_interval;

    if (
      media?.media_type === "video" &&
      media.duration &&
      media.duration > interval
    ) {
      // Video is longer than interval — wait for it to finish
      waitingForVideo.current = true;
      return;
    }

    advanceTimer.current = setTimeout(goNext, interval * 1000);
    return () => clearTimeout(advanceTimer.current);
  }, [currentIndex, paused, settings, playlist, goNext]);

  // ─── Video ended handler ─────────────────────────────────────

  const handleVideoEnded = useCallback(() => {
    if (waitingForVideo.current) {
      goNext();
    }
  }, [goNext]);

  // ─── Video error handler — never get stuck ──────────────────

  const handleVideoError = useCallback(() => {
    goNext();
  }, [goNext]);

  // ─── Overlay auto-hide ──────────────────────────────────────

  const resetHideTimer = useCallback(() => {
    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setOverlayVisible(false), 5000);
  }, []);

  useEffect(() => {
    if (!overlayVisible) return;
    resetHideTimer();
    return () => clearTimeout(hideTimer.current);
  }, [overlayVisible, resetHideTimer]);

  const handleUpdateSettings = useCallback(
    async (update: Parameters<typeof api.settings.update>[0]) => {
      resetHideTimer();
      try {
        const updated = await api.settings.update(update);
        setSettings(updated);
      } catch {
        // Silently fail — overlay will show stale value
      }
    },
    [resetHideTimer],
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
      } else if (event.type === "media_processing_complete") {
        // Update media item in-place — video is now ready for slideshow
        const updated = event.payload as unknown as Media;
        setMediaList((prev) =>
          prev.map((m) => (m.id === updated.id ? updated : m)),
        );
      } else if (event.type === "settings_changed") {
        setSettings(event.payload as unknown as Settings);
      }
    },
    [currentIndex],
  );

  useWebSocket({ onEvent: handleWsEvent });

  // ─── Tap zone interaction ──────────────────────────────────

  const handlePointerDown = useCallback(() => {
    didLongPress.current = false;
    longPressTimer.current = setTimeout(() => {
      didLongPress.current = true;
      setOverlayVisible((v) => !v);
    }, 500);
  }, []);

  const handlePointerUp = useCallback(() => {
    clearTimeout(longPressTimer.current);
  }, []);

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      if (didLongPress.current) return;
      if (overlayVisible) {
        // Click outside overlay dismisses it
        setOverlayVisible(false);
        return;
      }

      const midX = window.innerWidth / 2;
      if (e.clientX >= midX) {
        goNext();
      } else {
        goPrev();
      }
    },
    [goNext, goPrev, overlayVisible],
  );

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

  const transitionStyle = settings?.transition_type ?? "none";

  return (
    <div
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onClick={handleClick}
      className="fixed inset-0 bg-black select-none overflow-hidden"
      style={{ cursor: overlayVisible ? "auto" : "none" }}
    >
      {/* Previous slide (fading/sliding out) */}
      {prevMedia && (
        <div
          className={`absolute inset-0 z-0 ${
            transitionStyle === "slide"
              ? "transition-transform duration-500 ease-in-out"
              : ""
          }`}
          style={{
            transform:
              transitionStyle === "slide"
                ? transitioning
                  ? "translateX(0)"
                  : "translateX(-100%)"
                : undefined,
          }}
        >
          <Slide media={prevMedia} videoRef={prevVideoRef} />
        </div>
      )}

      {/* Current slide */}
      <div
        className={`absolute inset-0 z-10 ${
          transitionStyle === "crossfade"
            ? "transition-opacity duration-500 ease-in-out"
            : transitionStyle === "slide"
              ? "transition-transform duration-500 ease-in-out"
              : ""
        }`}
        style={{
          opacity:
            transitionStyle === "crossfade"
              ? transitioning
                ? 0
                : 1
              : undefined,
          transform:
            transitionStyle === "slide"
              ? transitioning
                ? "translateX(100%)"
                : "translateX(0)"
              : undefined,
        }}
      >
        <Slide
          media={currentMedia!}
          videoRef={videoRef}
          onEnded={handleVideoEnded}
          onError={handleVideoError}
        />
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
          onInteraction={resetHideTimer}
        />
      )}
    </div>
  );
}

// ─── Slide component ─────────────────────────────────────────

interface SlideProps {
  media: Media;
  videoRef?: React.RefObject<HTMLVideoElement | null>;
  onEnded?: () => void;
  onError?: () => void;
}

function Slide({ media, videoRef, onEnded, onError }: SlideProps) {
  const src = originalUrl(media);

  if (media.media_type === "video") {
    return (
      <>
        {/* Blur background — use thumbnail image instead of second <video> to halve resource usage */}
        <img
          src={thumbnailUrl(media)}
          className="absolute inset-0 w-full h-full object-cover scale-[1.2] blur-[30px] brightness-[0.7]"
          alt=""
          aria-hidden="true"
        />
        {/* Foreground video */}
        <video
          ref={videoRef}
          src={src}
          className="absolute inset-0 w-full h-full object-contain"
          muted
          autoPlay
          onEnded={onEnded}
          onError={onError}
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
