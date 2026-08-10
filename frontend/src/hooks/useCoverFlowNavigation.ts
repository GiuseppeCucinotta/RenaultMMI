import { useCallback, useEffect, useRef, useState } from "react";

export interface CoverFlowNavigationOptions {
  count: number;
  onSelect: (index: number) => void;
  wrap?: boolean;
  enabled?: boolean;
}

export function useCoverFlowNavigation({
  count,
  onSelect,
  wrap = true,
  enabled = true,
}: CoverFlowNavigationOptions) {
  const containerRef = useRef<HTMLElement>(null);
  const [focusedIndex, setFocusedIndexState] = useState(0);

  const countRef = useRef(count);
  const wrapRef = useRef(wrap);
  const onSelectRef = useRef(onSelect);
  const indexRef = useRef(0);
  const dragRef = useRef({
    active: false,
    pointerId: -1,
    lastX: 0,
    accum: 0,
    moved: false,
    suppressClick: false,
    suppressUntil: 0,
  });
  const wheelRef = useRef({ accum: 0, lockedUntil: 0 });

  countRef.current = count;
  wrapRef.current = wrap;
  onSelectRef.current = onSelect;

  useEffect(() => {
    if (count <= 0) return;
    if (indexRef.current >= count) {
      const next = count - 1;
      indexRef.current = next;
      setFocusedIndexState(next);
    }
  }, [count]);

  const setFocusedIndex = useCallback((next: number) => {
    const clamped = Math.max(0, Math.min(countRef.current - 1, next));
    indexRef.current = clamped;
    setFocusedIndexState(clamped);
  }, []);

  const move = useCallback(
    (direction: 1 | -1) => {
      if (countRef.current <= 0) return;
      let next = indexRef.current + direction;
      if (next < 0) next = wrapRef.current ? countRef.current - 1 : 0;
      if (next >= countRef.current) next = wrapRef.current ? 0 : countRef.current - 1;
      setFocusedIndex(next);
    },
    [setFocusedIndex],
  );

  const selectFocused = useCallback(() => {
    const drag = dragRef.current;
    drag.suppressClick = false;
    drag.suppressUntil = 0;
    const container = containerRef.current;
    const button = container?.querySelector<HTMLElement>(
      `[data-cover-index="${indexRef.current}"]`,
    );
    if (button) {
      button.click();
      return;
    }
    if (countRef.current > 0) onSelectRef.current(indexRef.current);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const container = containerRef.current;
    if (!container) return;

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const wheel = wheelRef.current;
      const now = performance.now();
      wheel.accum += event.deltaY;
      if (now < wheel.lockedUntil) return;
      const THRESHOLD = 90;
      const LOCK_MS = 50;
      if (Math.abs(wheel.accum) < THRESHOLD) return;
      move(wheel.accum > 0 ? 1 : -1);
      wheel.accum = wheel.accum % THRESHOLD;
      wheel.lockedUntil = now + LOCK_MS;
    };

    const onKeyDown = (event: KeyboardEvent) => {
      switch (event.key) {
        case "ArrowRight":
        case "ArrowDown":
          event.preventDefault();
          move(1);
          break;
        case "ArrowLeft":
        case "ArrowUp":
          event.preventDefault();
          move(-1);
          break;
        case "Enter":
        case " ":
          event.preventDefault();
          selectFocused();
          break;
      }
    };

    const onAuxClick = (event: MouseEvent) => {
      if (event.button === 1) {
        event.preventDefault();
        selectFocused();
      }
    };

    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      const drag = dragRef.current;
      drag.active = true;
      drag.pointerId = event.pointerId;
      drag.lastX = event.clientX;
      drag.accum = 0;
      drag.moved = false;
      drag.suppressClick = false;
      drag.suppressUntil = 0;
    };

    const DRAG_STEP_PX = 40;

    const onPointerMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag.active || event.pointerId !== drag.pointerId) return;
      drag.accum += event.clientX - drag.lastX;
      drag.lastX = event.clientX;
      while (drag.accum >= DRAG_STEP_PX) {
        move(1);
        drag.accum -= DRAG_STEP_PX;
        drag.moved = true;
      }
      while (drag.accum <= -DRAG_STEP_PX) {
        move(-1);
        drag.accum += DRAG_STEP_PX;
        drag.moved = true;
      }
    };

    const endDrag = () => {
      const drag = dragRef.current;
      if (!drag.active) return;
      drag.active = false;
      drag.pointerId = -1;
      drag.accum = 0;
      drag.suppressClick = drag.moved;
      drag.suppressUntil = drag.moved ? performance.now() + 400 : 0;
      drag.moved = false;
    };

    const onPointerUp = (event: PointerEvent) => {
      if (event.pointerId !== dragRef.current.pointerId) return;
      endDrag();
    };

    const onPointerCancel = (event: PointerEvent) => {
      if (event.pointerId !== dragRef.current.pointerId) return;
      endDrag();
    };

    const onClickCapture = (event: MouseEvent) => {
      const drag = dragRef.current;
      if (drag.suppressClick && performance.now() < drag.suppressUntil) {
        event.preventDefault();
        event.stopPropagation();
      }
      drag.suppressClick = false;
      drag.suppressUntil = 0;
    };

    const onClick = () => {
      if (container.ownerDocument.activeElement !== container) {
        container.focus({ preventScroll: true });
      }
    };

    container.addEventListener("wheel", onWheel, { passive: false });
    container.addEventListener("keydown", onKeyDown);
    container.addEventListener("auxclick", onAuxClick);
    container.addEventListener("pointerdown", onPointerDown);
    container.addEventListener("pointermove", onPointerMove);
    container.addEventListener("pointerup", onPointerUp);
    container.addEventListener("pointercancel", onPointerCancel);
    container.addEventListener("click", onClickCapture, { capture: true });
    container.addEventListener("click", onClick);

    if (!container.contains(container.ownerDocument.activeElement)) {
      container.focus({ preventScroll: true });
    }

    return () => {
      container.removeEventListener("wheel", onWheel);
      container.removeEventListener("keydown", onKeyDown);
      container.removeEventListener("auxclick", onAuxClick);
      container.removeEventListener("pointerdown", onPointerDown);
      container.removeEventListener("pointermove", onPointerMove);
      container.removeEventListener("pointerup", onPointerUp);
      container.removeEventListener("pointercancel", onPointerCancel);
      container.removeEventListener("click", onClickCapture, { capture: true });
      container.removeEventListener("click", onClick);
    };
  }, [enabled, count, move, selectFocused]);

  return { containerRef, focusedIndex, setFocusedIndex };
}
