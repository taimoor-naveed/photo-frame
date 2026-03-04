import { useCallback, useEffect, useRef, useState } from "react";
import { useSettings } from "../hooks/useSettings";

export default function SettingsPage() {
  const { settings, loading, error, saved, updateSettings } = useSettings();
  const [localInterval, setLocalInterval] = useState<number | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync local state when settings load or change externally
  useEffect(() => {
    if (settings && localInterval === null) {
      setLocalInterval(settings.slideshow_interval);
    }
  }, [settings, localInterval]);

  const handleIntervalChange = useCallback(
    (value: number) => {
      setLocalInterval(value);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        updateSettings({ slideshow_interval: value });
      }, 400);
    },
    [updateSettings],
  );

  // Cleanup debounce timer on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  if (loading || !settings) {
    return (
      <div>
        <h1 className="font-display text-3xl text-warm-white mb-10">Settings</h1>
        <div className="rounded-2xl bg-surface border border-white/[0.06] p-8 shadow-gallery space-y-8">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="animate-pulse">
              <div className="h-3 w-32 bg-white/[0.06] rounded mb-3" />
              <div className="h-10 w-full bg-white/[0.04] rounded-xl" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-10">
        <h1 className="font-display text-3xl text-warm-white">Settings</h1>
        {saved && (
          <span className="text-sm font-medium text-emerald-400">
            Saved
          </span>
        )}
        {error && (
          <span className="text-sm font-medium text-red-400">{error}</span>
        )}
      </div>

      <div className="rounded-2xl bg-surface border border-white/[0.06] p-8 shadow-gallery space-y-8">
        {/* Slideshow Interval */}
        <div>
          <label className="block text-xs font-semibold uppercase tracking-widest text-warm-gray mb-4">
            Slideshow Interval
            <span className="ml-2 normal-case tracking-normal text-copper font-medium">
              {localInterval ?? settings.slideshow_interval}s
            </span>
          </label>
          <input
            type="range"
            min={3}
            max={60}
            step={1}
            value={localInterval ?? settings.slideshow_interval}
            onChange={(e) => handleIntervalChange(Number(e.target.value))}
            className="w-full"
          />
          <div className="flex justify-between text-xs text-warm-muted mt-1.5">
            <span>3s</span>
            <span>60s</span>
          </div>
        </div>

        {/* Transition Type */}
        <div>
          <label className="block text-xs font-semibold uppercase tracking-widest text-warm-gray mb-4">
            Transition
          </label>
          <div className="flex gap-2">
            {["crossfade", "slide", "none"].map((type) => (
              <button
                key={type}
                onClick={() => updateSettings({ transition_type: type })}
                className={`rounded-xl px-4 py-2.5 text-sm font-medium capitalize transition-colors ${
                  settings.transition_type === type
                    ? "bg-copper text-ink"
                    : "bg-white/[0.04] text-warm-gray hover:bg-white/[0.08] hover:text-warm-white"
                }`}
              >
                {type}
              </button>
            ))}
          </div>
        </div>

      </div>
    </div>
  );
}
