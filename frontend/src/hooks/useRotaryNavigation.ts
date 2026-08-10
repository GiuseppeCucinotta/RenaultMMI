import { useCallback, useEffect, useRef } from "react";

interface RotaryOptions {
  selector: string;
  wrap?: boolean;
  enabled?: boolean;
}

export function useRotaryNavigation({
  selector,
  wrap = true,
  enabled = true,
}: RotaryOptions) {
  const containerRef = useRef<HTMLDivElement>(null);
  const indexRef = useRef(0);

  const getItems = useCallback(
    () =>
      containerRef.current
        ? Array.from(
            containerRef.current.querySelectorAll<HTMLElement>(selector),
          ).filter((el) => !(el as HTMLButtonElement).disabled && el.tabIndex !== -1)
        : [],
    [selector],
  );

  const focusItem = useCallback(
    (index: number) => {
      const items = getItems();
      const target = items[index];
      if (target) {
        target.focus({ preventScroll: true });
        indexRef.current = index;
      }
    },
    [getItems],
  );

  const focusElement = useCallback(
    (element: HTMLElement | null) => {
      if (!element) return;
      const items = getItems();
      const idx = items.indexOf(element);
      if (idx !== -1) {
        element.focus({ preventScroll: true });
        indexRef.current = idx;
      }
    },
    [getItems],
  );

  const focusNext = useCallback(() => {
    const items = getItems();
    if (items.length === 0) return;
    const next = indexRef.current + 1;
    if (next >= items.length) {
      if (wrap) focusItem(0);
    } else {
      focusItem(next);
    }
  }, [getItems, wrap, focusItem]);

  const focusPrev = useCallback(() => {
    const items = getItems();
    if (items.length === 0) return;
    const prev = indexRef.current - 1;
    if (prev < 0) {
      if (wrap) focusItem(items.length - 1);
    } else {
      focusItem(prev);
    }
  }, [getItems, wrap, focusItem]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !enabled) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.deltaY > 0) focusNext();
      else if (e.deltaY < 0) focusPrev();
    };

    const onKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case "ArrowRight":
        case "ArrowDown":
          e.preventDefault();
          focusNext();
          break;
        case "ArrowLeft":
        case "ArrowUp":
          e.preventDefault();
          focusPrev();
          break;
        case "Enter":
        case " ":
          clickFocused(e);
          break;
      }
    };

    const onAuxClick = (e: MouseEvent) => {
      if (e.button === 1) {
        e.preventDefault();
        clickFocused(e);
      }
    };

    function clickFocused(e: Event) {
      if (document.activeElement instanceof HTMLElement) {
        e.preventDefault();
        document.activeElement.click();
      }
    }

    const onFocusIn = () => {
      const items = getItems();
      const focused = document.activeElement;
      if (!focused || !container.contains(focused)) return;
      const idx = items.indexOf(focused as HTMLElement);
      if (idx !== -1) indexRef.current = idx;
    };

    container.addEventListener("wheel", onWheel, { passive: false });
    container.addEventListener("keydown", onKeyDown);
    container.addEventListener("auxclick", onAuxClick);
    container.addEventListener("focusin", onFocusIn);

    if (getItems().length > 0 && !container.contains(document.activeElement)) {
      focusItem(0);
    }

    return () => {
      container.removeEventListener("wheel", onWheel);
      container.removeEventListener("keydown", onKeyDown);
      container.removeEventListener("auxclick", onAuxClick);
      container.removeEventListener("focusin", onFocusIn);
    };
  }, [enabled, focusNext, focusPrev, focusItem, getItems, selector]);

  return { containerRef, enabled, focusElement };
}
