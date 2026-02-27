import { renderHook } from "@testing-library/react";
import { useGestures } from "../hooks/useGestures";

// Note: @use-gesture/react drag handlers are complex to simulate in unit tests.
// These tests verify the hook returns the expected interface.
// Full gesture behavior is tested in E2E tests.

describe("useGestures", () => {
  it("returns bind and cleanup functions", () => {
    const { result } = renderHook(() =>
      useGestures({
        onSwipeLeft: vi.fn(),
        onSwipeRight: vi.fn(),
        onTap: vi.fn(),
        onLongPress: vi.fn(),
      }),
    );

    expect(result.current.bind).toBeDefined();
    expect(typeof result.current.bind).toBe("function");
    expect(typeof result.current.cleanup).toBe("function");
  });

  it("bind returns gesture handler props", () => {
    const { result } = renderHook(() =>
      useGestures({
        onSwipeLeft: vi.fn(),
        onSwipeRight: vi.fn(),
        onTap: vi.fn(),
        onLongPress: vi.fn(),
      }),
    );

    const props = result.current.bind();
    expect(props).toBeDefined();
    expect(typeof props).toBe("object");
  });

  it("works with no callbacks", () => {
    const { result } = renderHook(() => useGestures({}));

    expect(result.current.bind).toBeDefined();
    const props = result.current.bind();
    expect(props).toBeDefined();
  });
});
