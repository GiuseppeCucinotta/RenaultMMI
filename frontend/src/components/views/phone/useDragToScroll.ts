import { useEffect, useRef } from "react";

/**
 * Drag-to-scroll for the device list.
 *
 * Native overflow scrolling already covers the wheel and touchscreen pans,
 * but a pressed-button drag (mouse, and some touch stacks) does not scroll a
 * plain overflow container. Dragging vertically scrolls it instead. A drag
 * past a small threshold swallows the trailing click so rows are not
 * accidentally activated mid-scroll; plain taps still click through.
 */
export function useDragToScroll<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (el == null) return;

    let activePointer: number | null = null;
    let startY = 0;
    let startScrollTop = 0;
    let dragging = false;

    const onPointerDown = (event: PointerEvent) => {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      activePointer = event.pointerId;
      startY = event.clientY;
      startScrollTop = el.scrollTop;
      dragging = false;
    };

    const onPointerMove = (event: PointerEvent) => {
      if (activePointer == null || event.pointerId !== activePointer) return;
      const dy = event.clientY - startY;
      if (!dragging && Math.abs(dy) > 6) {
        dragging = true;
        el.setPointerCapture(event.pointerId);
      }
      if (dragging) {
        el.scrollTop = startScrollTop - dy;
      }
    };

    const endDrag = (event: PointerEvent) => {
      if (activePointer == null || event.pointerId !== activePointer) return;
      activePointer = null;
      if (!dragging) return;
      dragging = false;
      // A drag ends with a click under the pointer — swallow that one only.
      const swallow = (click: Event) => {
        click.stopPropagation();
        click.preventDefault();
      };
      el.addEventListener("click", swallow, { capture: true, once: true });
      window.setTimeout(() => el.removeEventListener("click", swallow, { capture: true }), 0);
    };

    el.addEventListener("pointerdown", onPointerDown);
    el.addEventListener("pointermove", onPointerMove);
    el.addEventListener("pointerup", endDrag);
    el.addEventListener("pointercancel", endDrag);
    return () => {
      el.removeEventListener("pointerdown", onPointerDown);
      el.removeEventListener("pointermove", onPointerMove);
      el.removeEventListener("pointerup", endDrag);
      el.removeEventListener("pointercancel", endDrag);
    };
  }, []);

  return ref;
}
