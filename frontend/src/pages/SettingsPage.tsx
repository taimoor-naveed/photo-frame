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
        <h1 className="text-2xl font-semibold text-gray-900 mb-8">Settings</h1>
        <div className="rounded-2xl bg-white p-8 shadow-sm space-y-8">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="animate-pulse">
              <div className="h-4 w-32 bg-gray-200 rounded mb-3" />
              <div className="h-10 w-full bg-gray-100 rounded-xl" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-2xl font-semibold text-gray-900">Settings</h1>
        {saved && (
          <span className="text-sm font-medium text-green-600 animate-in">
            Saved
          </span>
        )}
        {error && (
          <span className="text-sm font-medium text-red-500">{error}</span>
        )}
      </div>

      <div className="rounded-2xl bg-white p-8 shadow-sm space-y-8">
        {/* Slideshow Interval */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-3">
            Slideshow Interval
            <span className="ml-2 text-gray-400 font-normal">
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
            className="w-full h-2 bg-gray-200 rounded-full appearance-none cursor-pointer accent-gray-900"
          />
          <div className="flex justify-between text-xs text-gray-400 mt-1">
            <span>3s</span>
            <span>60s</span>
          </div>
        </div>

        {/* Transition Type */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-3">
            Transition
          </label>
          <div className="flex gap-2">
            {["crossfade", "slide", "none"].map((type) => (
              <button
                key={type}
                onClick={() => updateSettings({ transition_type: type })}
                className={`rounded-xl px-4 py-2.5 text-sm font-medium capitalize transition-colors ${
                  settings.transition_type === type
                    ? "bg-gray-900 text-white"
                    : "bg-gray-100 text-gray-600 hover:bg-gray-200"
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
