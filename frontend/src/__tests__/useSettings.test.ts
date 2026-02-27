import { renderHook, waitFor, act } from "@testing-library/react";
import { useSettings } from "../hooks/useSettings";
import type { Settings } from "../api/client";

const mockSettings: Settings = {
  slideshow_interval: 10,
  transition_type: "crossfade",
};

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("useSettings", () => {
  it("fetches settings on mount", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => mockSettings,
    } as Response);

    const { result } = renderHook(() => useSettings());

    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.settings?.slideshow_interval).toBe(10);
    expect(result.current.settings?.transition_type).toBe("crossfade");
  });

  it("updates settings", async () => {
    const updated = { ...mockSettings, slideshow_interval: 20 };
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({
        ok: true,
        json: async () => mockSettings,
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => updated,
      } as Response);

    const { result } = renderHook(() => useSettings());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.updateSettings({ slideshow_interval: 20 });
    });

    expect(result.current.settings?.slideshow_interval).toBe(20);
    expect(result.current.saved).toBe(true);
  });

  it("handles update error", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({
        ok: true,
        json: async () => mockSettings,
      } as Response)
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => "Server error",
      } as Response);

    const { result } = renderHook(() => useSettings());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.updateSettings({ slideshow_interval: 999 });
    });

    expect(result.current.error).toBeTruthy();
  });
});
