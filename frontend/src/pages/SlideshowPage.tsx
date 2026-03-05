import { memo, useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api, blurUrl, displayUrl, thumbnailUrl, type Media, type Settings } from "../api/client";
import { useWebSocket, type WsEvent } from "../hooks/useWebSocket";
import SlideshowOverlay from "../components/SlideshowOverlay";

export default function SlideshowPage() {
  const [mediaList, setMediaList] = useState<Media[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  // Playlist + currentIndex in one state object — always update atomically
  const [slide, setSlide] = useState<{ playlist: Media[]; currentIndex: number }>({
    playlist: [],
    currentIndex: 0,
  });
  const [prevIndex, setPrevIndex] = useState<number | null>(null);
  const [transitioning, setTransitioning] = useState(false);
  const [paused, setPaused] = useState(false);
  const [overlayVisible, setOverlayVisible] = useState(false);

  const playlist = slide.playlist;
  const currentIndex = slide.currentIndex;

  const hideTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const advanceTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const videoRef = useRef<HTMLVideoElement>(null);
  const prevVideoRef = useRef<HTMLVideoElement>(null);
  const waitingForVideo = useRef(false);
  const longPressTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const didLongPress = useRef(false);
  const preloadVideoRef = useRef<HTMLVideoElement | null>(null);

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

  // ─── Shuffled playlist (only ready media) ──────────────────
  // Always random. Shuffle once on load. Insert new items at random positions.
  // Remove deleted items in place. No settings, no re-shuffling.

  const shuffleArray = useCallback(<T,>(arr: T[]): T[] => {
    const shuffled = [...arr];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }, []);

  // Build playlist on initial data load (even if empty — prevents useEffect from
  // fighting with the WS handler when the first photo arrives on an empty slideshow)
  const initialBuildDone = useRef(false);
  useEffect(() => {
    if (settings && !initialBuildDone.current) {
      initialBuildDone.current = true;
      const ready = mediaList.filter(
        (m) => m.media_type === "photo" || m.processing_status === "ready",
      );
      setSlide({ playlist: shuffleArray(ready), currentIndex: 0 });
    }
  }, [mediaList, settings, shuffleArray]);

  const currentMedia = playlist[currentIndex] ?? null;
  const prevMedia =
    prevIndex !== null ? playlist[prevIndex] ?? null : null;

  // ─── Navigation ──────────────────────────────────────────────

  const goToSlide = useCallback(
    (next: number) => {
      if (!playlist.length) return;
      if (next === currentIndex) return; // Single item or same slide — no transition
      waitingForVideo.current = false;
      setPrevIndex(currentIndex);
      setSlide((prev) => ({ ...prev, currentIndex: next }));
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
    if (paused || !settings || !currentMedia) return;

    const interval = settings.slideshow_interval;

    if (
      currentMedia.media_type === "video" &&
      currentMedia.duration &&
      currentMedia.duration > interval
    ) {
      // Video already ended (e.g. single-item playlist, new media just added) — advance now
      if (videoRef.current?.ended && playlist.length > 1) {
        setTimeout(() => goNextRef.current(), 0);
        return;
      }
      // Video is longer than interval — wait for it to finish
      waitingForVideo.current = true;
      return;
    }

    advanceTimer.current = setTimeout(() => goNextRef.current(), interval * 1000);
    return () => clearTimeout(advanceTimer.current);
  }, [currentMedia?.id, paused, settings?.slideshow_interval, currentMedia?.media_type, currentMedia?.duration, playlist.length]);

  // ─── Pause/resume video element ─────────────────────────────

  useEffect(() => {
    if (!videoRef.current) return;
    if (paused) {
      videoRef.current.pause();
    } else {
      videoRef.current.play()?.catch(() => {});
    }
  }, [paused, currentMedia?.id]);

  // ─── Video handlers (stable refs to avoid Slide re-renders) ──

  const goNextRef = useRef(goNext);
  useEffect(() => { goNextRef.current = goNext; }, [goNext]);

  const handleVideoEnded = useCallback(() => {
    if (waitingForVideo.current) {
      goNextRef.current();
    } else {
      // Video ended within interval — show first frame while waiting for timer
      if (videoRef.current) {
        videoRef.current.currentTime = 0;
      }
    }
  }, []);

  const handleVideoError = useCallback(() => {
    goNextRef.current();
  }, []);

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
      if (event.type === "media_added") {
        const added = event.payload as unknown as Media;
        setMediaList((prev) => [added, ...prev]);
        // Insert at random position with dedup guard
        const isReady =
          added.media_type === "photo" || added.processing_status === "ready";
        if (isReady) {
          setSlide((prev) => {
            if (prev.playlist.some((m) => m.id === added.id)) return prev;
            const newPlaylist = [...prev.playlist];
            const insertAt = Math.floor(Math.random() * (newPlaylist.length + 1));
            newPlaylist.splice(insertAt, 0, added);
            // When playlist was empty, show the new item immediately
            if (prev.playlist.length === 0) {
              return { playlist: newPlaylist, currentIndex: 0 };
            }
            const newIndex = insertAt <= prev.currentIndex
              ? prev.currentIndex + 1
              : prev.currentIndex;
            return { playlist: newPlaylist, currentIndex: newIndex };
          });
        }
      } else if (event.type === "media_deleted") {
        const { id } = event.payload as { id: number };
        setMediaList((prev) => prev.filter((m) => m.id !== id));
        // Atomically update playlist + currentIndex — handles duplicates safely
        setSlide((prev) => {
          const newPlaylist = prev.playlist.filter((m) => m.id !== id);
          if (newPlaylist.length === prev.playlist.length) return prev; // not found
          const removedBeforeCurrent = prev.playlist
            .slice(0, prev.currentIndex)
            .filter((m) => m.id === id).length;
          const currentWasDeleted = prev.playlist[prev.currentIndex]?.id === id;
          let newIndex = prev.currentIndex - removedBeforeCurrent;
          if (newPlaylist.length === 0) {
            newIndex = 0;
          } else if (currentWasDeleted) {
            newIndex = newIndex % newPlaylist.length;
          }
          return { playlist: newPlaylist, currentIndex: newIndex };
        });
      } else if (event.type === "media_processing_complete") {
        // Update media item in-place — video is now ready for slideshow
        const updated = event.payload as unknown as Media;
        setMediaList((prev) =>
          prev.map((m) => (m.id === updated.id ? updated : m)),
        );
        // Update in-place if already in playlist, otherwise insert at random position with dedup
        setSlide((prev) => {
          if (prev.playlist.some((m) => m.id === updated.id)) {
            return {
              ...prev,
              playlist: prev.playlist.map((m) =>
                m.id === updated.id ? updated : m,
              ),
            };
          }
          const newPlaylist = [...prev.playlist];
          const insertAt = Math.floor(Math.random() * (newPlaylist.length + 1));
          newPlaylist.splice(insertAt, 0, updated);
          if (prev.playlist.length === 0) {
            return { playlist: newPlaylist, currentIndex: 0 };
          }
          const newIndex = insertAt <= prev.currentIndex
            ? prev.currentIndex + 1
            : prev.currentIndex;
          return { playlist: newPlaylist, currentIndex: newIndex };
        });
      } else if (event.type === "settings_changed") {
        setSettings(event.payload as unknown as Settings);
        resetHideTimer();
      }
    },
    [resetHideTimer],
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

  // ─── Preload next media ───────────────────────────────────

  useEffect(() => {
    if (!playlist.length) return;
    const nextIdx = (currentIndex + 1) % playlist.length;
    const nextMedia = playlist[nextIdx];

    if (nextMedia?.media_type === "photo") {
      const img = new Image();
      img.src = displayUrl(nextMedia);
      const blur = blurUrl(nextMedia);
      if (blur) {
        const blurImg = new Image();
        blurImg.src = blur;
      }
    } else if (nextMedia?.media_type === "video") {
      const video = document.createElement("video");
      video.preload = "auto";
      video.muted = true;
      video.src = displayUrl(nextMedia);
      preloadVideoRef.current = video;
      const blur = blurUrl(nextMedia);
      if (blur) {
        const blurImg = new Image();
        blurImg.src = blur;
      }
    }

    return () => {
      if (preloadVideoRef.current) {
        preloadVideoRef.current.src = "";
        preloadVideoRef.current = null;
      }
    };
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
        {currentMedia && (
          <Slide
            media={currentMedia}
            videoRef={videoRef}
            onEnded={handleVideoEnded}
            onError={handleVideoError}
          />
        )}
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

const Slide = memo(function Slide({ media, videoRef, onEnded, onError }: SlideProps) {
  const src = displayUrl(media);
  const blur = blurUrl(media);

  // Blur background: use pre-rendered image if available, fall back to CSS blur
  const bgSrc = media.media_type === "video" ? (blur ?? thumbnailUrl(media)) : (blur ?? src);
  const bgClass = blur
    ? "absolute inset-0 w-full h-full object-cover brightness-[0.7]"
    : "absolute inset-0 w-full h-full object-cover scale-[1.2] blur-[30px] brightness-[0.7]";

  if (media.media_type === "video") {
    return (
      <>
        <img src={bgSrc} className={bgClass} alt="" aria-hidden="true" />
        <video
          ref={videoRef}
          src={src}
          data-media-id={media.id}
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
      <img src={bgSrc} className={bgClass} alt="" aria-hidden="true" />
      <img
        src={src}
        data-media-id={media.id}
        className="absolute inset-0 w-full h-full object-contain"
        alt={media.original_name}
      />
    </>
  );
});
