import { render, screen, fireEvent } from "@testing-library/react";
import SlideshowOverlay from "../components/SlideshowOverlay";
import type { Settings } from "../api/client";

const mockSettings: Settings = {
  slideshow_interval: 10,
  transition_type: "crossfade",
};

describe("SlideshowOverlay", () => {
  it("renders controls when visible", () => {
    render(
      <SlideshowOverlay
        visible={true}
        settings={mockSettings}
        paused={false}
        onTogglePause={() => {}}
        onUpdateSettings={() => {}}
      />,
    );

    expect(screen.getByLabelText("Pause slideshow")).toBeInTheDocument();
    expect(screen.getByText("crossfade")).toBeInTheDocument();
    expect(screen.getByText("Interval")).toBeInTheDocument();
    expect(screen.getByText("Transition")).toBeInTheDocument();
  });

  it("shows Resume label when paused", () => {
    render(
      <SlideshowOverlay
        visible={true}
        settings={mockSettings}
        paused={true}
        onTogglePause={() => {}}
        onUpdateSettings={() => {}}
      />,
    );

    expect(screen.getByLabelText("Resume slideshow")).toBeInTheDocument();
  });

  it("calls onTogglePause when pause button clicked", () => {
    const onTogglePause = vi.fn();
    render(
      <SlideshowOverlay
        visible={true}
        settings={mockSettings}
        paused={false}
        onTogglePause={onTogglePause}
        onUpdateSettings={() => {}}
      />,
    );

    fireEvent.click(screen.getByLabelText("Pause slideshow"));
    expect(onTogglePause).toHaveBeenCalledTimes(1);
  });

  it("calls onUpdateSettings when transition button clicked", () => {
    const onUpdate = vi.fn();
    render(
      <SlideshowOverlay
        visible={true}
        settings={mockSettings}
        paused={false}
        onTogglePause={() => {}}
        onUpdateSettings={onUpdate}
      />,
    );

    fireEvent.click(screen.getByText("slide"));
    expect(onUpdate).toHaveBeenCalledWith({ transition_type: "slide" });
  });

  it("does not render order buttons", () => {
    render(
      <SlideshowOverlay
        visible={true}
        settings={mockSettings}
        paused={false}
        onTogglePause={() => {}}
        onUpdateSettings={() => {}}
      />,
    );

    expect(screen.queryByText("Order")).not.toBeInTheDocument();
    expect(screen.queryByText("random")).not.toBeInTheDocument();
    expect(screen.queryByText("sequential")).not.toBeInTheDocument();
    expect(screen.queryByText("newest")).not.toBeInTheDocument();
  });

  it("has translate-y-full when not visible", () => {
    const { container } = render(
      <SlideshowOverlay
        visible={false}
        settings={mockSettings}
        paused={false}
        onTogglePause={() => {}}
        onUpdateSettings={() => {}}
      />,
    );

    const overlay = container.firstElementChild as HTMLElement;
    expect(overlay.className).toContain("translate-y-full");
  });
});
