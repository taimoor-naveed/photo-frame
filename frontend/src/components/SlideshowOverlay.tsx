import { Link } from "react-router-dom";
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
  const stopPropagation = (e: React.SyntheticEvent) => {
    e.stopPropagation();
    onInteraction?.();
  };

  return (
    <div
      className={`fixed bottom-0 left-0 right-0 z-40 transition-transform duration-300 ease-out ${
        visible ? "translate-y-0" : "translate-y-full"
      }`}
      onPointerDown={stopPropagation}
      onPointerUp={stopPropagation}
      onClick={stopPropagation}
    >
      <div className="mx-auto max-w-lg p-4 pb-8">
        <div className="rounded-2xl bg-black/60 backdrop-blur-xl p-6 shadow-2xl text-white">
          {/* Pause / Play */}
          <div className="flex items-center justify-between mb-5">
            <button
              onClick={onTogglePause}
              className="flex items-center gap-2 rounded-xl bg-white/15 px-4 py-2.5 text-sm font-medium hover:bg-white/25 transition-colors"
              aria-label={paused ? "Resume slideshow" : "Pause slideshow"}
            >
              {paused ? (
                <>
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M6.3 2.84A1.5 1.5 0 004 4.11v11.78a1.5 1.5 0 002.3 1.27l9.344-5.891a1.5 1.5 0 000-2.538L6.3 2.841z" />
                  </svg>
                  Play
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M5.75 3a.75.75 0 00-.75.75v12.5c0 .414.336.75.75.75h1.5a.75.75 0 00.75-.75V3.75A.75.75 0 007.25 3h-1.5zM12.75 3a.75.75 0 00-.75.75v12.5c0 .414.336.75.75.75h1.5a.75.75 0 00.75-.75V3.75a.75.75 0 00-.75-.75h-1.5z" />
                  </svg>
                  Pause
                </>
              )}
            </button>

            <Link
              to="/"
              className="rounded-xl bg-white/15 px-4 py-2.5 text-sm font-medium hover:bg-white/25 transition-colors"
            >
              Manage Photos
            </Link>
          </div>

          {/* Interval Slider */}
          <div className="mb-5">
            <label className="block text-xs font-medium text-white/60 mb-2">
              Interval
              <span className="ml-2 text-white/80">
                {settings.slideshow_interval}s
              </span>
            </label>
            <input
              type="range"
              min={3}
              max={60}
              step={1}
              value={settings.slideshow_interval}
              onChange={(e) =>
                onUpdateSettings({
                  slideshow_interval: Number(e.target.value),
                })
              }
              className="w-full h-1.5 bg-white/20 rounded-full appearance-none cursor-pointer accent-white"
            />
            <div className="flex justify-between text-[10px] text-white/40 mt-1">
              <span>3s</span>
              <span>60s</span>
            </div>
          </div>

          {/* Transition */}
          <div className="mb-4">
            <label className="block text-xs font-medium text-white/60 mb-2">
              Transition
            </label>
            <div className="flex gap-2">
              {["crossfade", "slide", "none"].map((type) => (
                <button
                  key={type}
                  onClick={() => onUpdateSettings({ transition_type: type })}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium capitalize transition-colors ${
                    settings.transition_type === type
                      ? "bg-white text-black"
                      : "bg-white/15 text-white/80 hover:bg-white/25"
                  }`}
                >
                  {type}
                </button>
              ))}
            </div>
          </div>

          {/* Photo Order */}
          <div>
            <label className="block text-xs font-medium text-white/60 mb-2">
              Order
            </label>
            <div className="flex gap-2">
              {["random", "sequential", "newest"].map((order) => (
                <button
                  key={order}
                  onClick={() => onUpdateSettings({ photo_order: order })}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium capitalize transition-colors ${
                    settings.photo_order === order
                      ? "bg-white text-black"
                      : "bg-white/15 text-white/80 hover:bg-white/25"
                  }`}
                >
                  {order}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
