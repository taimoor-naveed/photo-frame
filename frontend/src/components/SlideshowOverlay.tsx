import { useCallback, useEffect, useRef, useState } from "react";
import type { Settings, SettingsUpdate } from "../api/client";

interface SlideshowOverlayProps {
  visible: boolean;
  settings: Settings;
  paused: boolean;
  onTogglePause: () => void;
  onUpdateSettings: (update: SettingsUpdate) => void;
  onInteraction?: () => void;
}

export default function SlideshowOverlay({
  visible,
  settings,
  paused,
  onTogglePause,
  onUpdateSettings,
  onInteraction,
}: SlideshowOverlayProps) {
  const [localInterval, setLocalInterval] = useState(settings.slideshow_interval);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync local state when settings change externally (e.g. WS broadcast)
  useEffect(() => {
    setLocalInterval(settings.slideshow_interval);
  }, [settings.slideshow_interval]);

  // Cleanup debounce timer on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const handleIntervalChange = useCallback(
    (value: number) => {
      setLocalInterval(value);
      onInteraction?.();
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        onUpdateSettings({ slideshow_interval: value });
      }, 400);
    },
    [onUpdateSettings, onInteraction],
  );

  const stopPropagation = (e: React.SyntheticEvent) => {
    e.stopPropagation();
    onInteraction?.();
  };

  return (
    <div
      className={`fixed bottom-0 inset-x-0 z-40 transition-transform duration-300 ease-out ${
        visible ? "translate-y-0" : "translate-y-full"
      }`}
      onPointerDown={stopPropagation}
      onPointerUp={stopPropagation}
      onClick={stopPropagation}
    >
      <div className="max-w-2xl mx-auto">
        <div
          data-testid="slideshow-overlay"
          className="bg-black/50 backdrop-blur-2xl rounded-t-3xl border-t border-white/[0.1] shadow-2xl"
        >
          {/* Drag handle */}
          <div className="flex justify-center pt-3 pb-4">
            <div className="w-8 h-1 rounded-full bg-white/25" />
          </div>

          <div className="px-6 pb-8 space-y-6">
            {/* Play / Pause — large centered button */}
            <div className="flex justify-center">
              <button
                onClick={onTogglePause}
                className="w-14 h-14 rounded-full bg-copper flex items-center justify-center shadow-lg shadow-copper/20 hover:bg-copper-light active:scale-95 transition-all"
                aria-label={paused ? "Resume slideshow" : "Pause slideshow"}
              >
                {paused ? (
                  <svg className="w-6 h-6 text-ink ml-0.5" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M6.3 2.84A1.5 1.5 0 004 4.11v11.78a1.5 1.5 0 002.3 1.27l9.344-5.891a1.5 1.5 0 000-2.538L6.3 2.841z" />
                  </svg>
                ) : (
                  <svg className="w-6 h-6 text-ink" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M5.75 3a.75.75 0 00-.75.75v12.5c0 .414.336.75.75.75h1.5a.75.75 0 00.75-.75V3.75A.75.75 0 007.25 3h-1.5zM12.75 3a.75.75 0 00-.75.75v12.5c0 .414.336.75.75.75h1.5a.75.75 0 00.75-.75V3.75a.75.75 0 00-.75-.75h-1.5z" />
                  </svg>
                )}
              </button>
            </div>

            {/* Interval Slider */}
            <div>
              <div className="flex items-baseline justify-between mb-3">
                <span className="text-[11px] font-semibold uppercase tracking-widest text-white/50">
                  Interval
                </span>
                <span className="text-sm font-medium text-white/80 tabular-nums">
                  {localInterval}s
                </span>
              </div>
              <input
                type="range"
                min={3}
                max={60}
                step={1}
                value={localInterval}
                onChange={(e) => handleIntervalChange(Number(e.target.value))}
                className="w-full"
              />
              <div className="flex justify-between text-[10px] text-white/30 mt-1.5">
                <span>3s</span>
                <span>60s</span>
              </div>
            </div>

            {/* Transition — segmented control */}
            <div>
              <span className="block text-[11px] font-semibold uppercase tracking-widest text-white/50 mb-3">
                Transition
              </span>
              <div className="flex rounded-xl bg-white/[0.08] p-1">
                {["crossfade", "slide", "none"].map((type) => (
                  <button
                    key={type}
                    onClick={() => onUpdateSettings({ transition_type: type })}
                    className={`flex-1 rounded-lg py-2.5 text-sm font-medium capitalize transition-all ${
                      settings.transition_type === type
                        ? "bg-copper text-ink shadow-sm"
                        : "text-white/60 active:text-white/80"
                    }`}
                  >
                    {type}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
