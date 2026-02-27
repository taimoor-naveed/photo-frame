import { useCallback, useEffect, useState } from "react";
import { api, type Settings, type SettingsUpdate } from "../api/client";

export function useSettings() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const fetchSettings = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.settings.get();
      setSettings(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load settings");
    } finally {
      setLoading(false);
    }
  }, []);

  const updateSettings = useCallback(
    async (update: SettingsUpdate) => {
      setError(null);
      setSaved(false);
      try {
        const data = await api.settings.update(update);
        setSettings(data);
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to save settings");
      }
    },
    [],
  );

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  return { settings, loading, error, saved, fetchSettings, updateSettings };
}
