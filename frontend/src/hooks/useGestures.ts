import { useCallback, useRef } from "react";
import { useDrag } from "@use-gesture/react";

interface UseGesturesOptions {
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
  onTap?: () => void;
  onLongPress?: () => void;
}

const SWIPE_THRESHOLD = 50;
const LONG_PRESS_MS = 500;

export function useGestures({
  onSwipeLeft,
  onSwipeRight,
  onTap,
  onLongPress,
}: UseGesturesOptions) {
  const longPressTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const didLongPress = useRef(false);

  const bindDrag = useDrag(
    ({ swipe: [sx], tap, first, active }) => {
      if (first) {
        didLongPress.current = false;
        longPressTimer.current = setTimeout(() => {
          didLongPress.current = true;
          onLongPress?.();
        }, LONG_PRESS_MS);
      }

      if (!active) {
        clearTimeout(longPressTimer.current);
      }

      // Cancel long press on significant movement (swipe)
      if (sx !== 0) {
        clearTimeout(longPressTimer.current);
      }

      if (active) return;

      if (sx === -1) {
        onSwipeLeft?.();
      } else if (sx === 1) {
        onSwipeRight?.();
      } else if (tap && !didLongPress.current) {
        onTap?.();
      }
    },
    {
      swipe: { distance: SWIPE_THRESHOLD, velocity: 0.1 },
      filterTaps: true,
    },
  );

  const cleanup = useCallback(() => {
    clearTimeout(longPressTimer.current);
  }, []);

  return {
    bind: bindDrag,
    cleanup,
  };
}
