import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import SettingsPage from "../pages/SettingsPage";
import type { Settings } from "../api/client";

const mockSettings: Settings = {
  slideshow_interval: 10,
  transition_type: "crossfade",
};

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("SettingsPage", () => {
  it("shows loading skeletons initially", () => {
    vi.spyOn(globalThis, "fetch").mockReturnValue(new Promise(() => {}));
    const { container } = render(
      <MemoryRouter>
        <SettingsPage />
      </MemoryRouter>,
    );
    expect(container.querySelectorAll(".animate-pulse").length).toBeGreaterThan(0);
  });

  it("renders settings controls without photo order", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => mockSettings,
    } as Response);

    render(
      <MemoryRouter>
        <SettingsPage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText("Slideshow Interval")).toBeInTheDocument();
    });
    expect(screen.getByText("Transition")).toBeInTheDocument();
    expect(screen.getByText("crossfade")).toBeInTheDocument();
    // Photo Order section should not exist
    expect(screen.queryByText("Photo Order")).not.toBeInTheDocument();
    expect(screen.queryByText("random")).not.toBeInTheDocument();
    expect(screen.queryByText("sequential")).not.toBeInTheDocument();
    expect(screen.queryByText("newest")).not.toBeInTheDocument();
  });

  it("calls update when transition button clicked", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({
        ok: true,
        json: async () => mockSettings,
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ...mockSettings, transition_type: "slide" }),
      } as Response);

    render(
      <MemoryRouter>
        <SettingsPage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText("slide")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("slide"));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });
});
