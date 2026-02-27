import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import SlideshowOverlay from "../components/SlideshowOverlay";
import type { Settings } from "../api/client";

const mockSettings: Settings = {
  slideshow_interval: 10,
  transition_type: "crossfade",
  photo_order: "random",
};

describe("SlideshowOverlay", () => {
  it("renders controls when visible", () => {
    render(
      <MemoryRouter>
        <SlideshowOverlay
          visible={true}
          settings={mockSettings}
          paused={false}
          onTogglePause={() => {}}
          onUpdateSettings={() => {}}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText("Pause")).toBeInTheDocument();
    expect(screen.getByText("Manage Photos")).toBeInTheDocument();
    expect(screen.getByText("crossfade")).toBeInTheDocument();
    expect(screen.getByText("random")).toBeInTheDocument();
  });

  it("shows Play when paused", () => {
    render(
      <MemoryRouter>
        <SlideshowOverlay
          visible={true}
          settings={mockSettings}
          paused={true}
          onTogglePause={() => {}}
          onUpdateSettings={() => {}}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText("Play")).toBeInTheDocument();
  });

  it("calls onTogglePause when pause button clicked", () => {
    const onTogglePause = vi.fn();
    render(
      <MemoryRouter>
        <SlideshowOverlay
          visible={true}
          settings={mockSettings}
          paused={false}
          onTogglePause={onTogglePause}
          onUpdateSettings={() => {}}
        />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByLabelText("Pause slideshow"));
    expect(onTogglePause).toHaveBeenCalledTimes(1);
  });

  it("calls onUpdateSettings when transition button clicked", () => {
    const onUpdate = vi.fn();
    render(
      <MemoryRouter>
        <SlideshowOverlay
          visible={true}
          settings={mockSettings}
          paused={false}
          onTogglePause={() => {}}
          onUpdateSettings={onUpdate}
        />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByText("slide"));
    expect(onUpdate).toHaveBeenCalledWith({ transition_type: "slide" });
  });

  it("calls onUpdateSettings when order button clicked", () => {
    const onUpdate = vi.fn();
    render(
      <MemoryRouter>
        <SlideshowOverlay
          visible={true}
          settings={mockSettings}
          paused={false}
          onTogglePause={() => {}}
          onUpdateSettings={onUpdate}
        />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByText("sequential"));
    expect(onUpdate).toHaveBeenCalledWith({ photo_order: "sequential" });
  });

  it("has translate-y-full when not visible", () => {
    const { container } = render(
      <MemoryRouter>
        <SlideshowOverlay
          visible={false}
          settings={mockSettings}
          paused={false}
          onTogglePause={() => {}}
          onUpdateSettings={() => {}}
        />
      </MemoryRouter>,
    );

    const overlay = container.firstElementChild as HTMLElement;
    expect(overlay.className).toContain("translate-y-full");
  });
});
