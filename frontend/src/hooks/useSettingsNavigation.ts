import { useCallback, useEffect, useRef } from "react";

/** Marks the elements the rotary input steps through (rail items, field rows). */
export const SETTINGS_FOCUSABLE_SELECTOR = "[data-settings-focusable]";

export interface SettingsNavigationOptions {
  enabled?: boolean;
}

export interface SettingsNavigation {
  containerRef: React.RefObject<HTMLDivElement>;
}

/** Reads a field row's declared kind from its data attribute. */
function rowKind(element: HTMLElement): string {
  return element.dataset.settingsRowKind ?? "";
}

function stepDelta(key: string): number | null {
  if (key === "ArrowRight" || key === "ArrowUp") return 1;
  if (key === "ArrowLeft" || key === "ArrowDown") return -1;
  return null;
}

/**
 * Rotary/keyboard navigation for the Settings view.
 *
 * Why this is not `useRotaryNavigation`: that hook is the right tool for grids
 * of plain buttons, but it maps *every* arrow key to focus movement. A settings
 * form contains real value controls, so this hook keeps the shared hook's
 * wheel-driven step behaviour while giving arrow keys control semantics:
 *
 * - `slider` / `stepper` rows: arrows adjust the value by its declared `step`,
 *   by clicking the row's own `[data-settings-step]` button. Radix's fine-grained
 *   keyboard control is deliberately not used, because a rotary encoder arrives
 *   as arrow keys and would then fight the focus movement the wheel performs.
 * - every other row: arrows move focus, exactly like the shared hook.
 * - `Escape` returns focus to the first item (the category rail).
 * - `Enter` / `Space` / middle-click activate the focused row, preserving the
 *   repo-wide activation behaviour.
 */
export function useSettingsNavigation({
  enabled = true,
}: SettingsNavigationOptions = {}): SettingsNavigation {
  const containerRef = useRef<HTMLDivElement>(null);
  const indexRef = useRef(0);

  const getItems = useCallback(
    () =>
      containerRef.current
        ? Array.from(
            containerRef.current.querySelectorAll<HTMLElement>(SETTINGS_FOCUSABLE_SELECTOR),
          ).filter((element) => !(element as HTMLButtonElement).disabled && element.tabIndex !== -1)
        : [],
    [],
  );

  const focusIndex = useCallback(
    (index: number) => {
      const items = getItems();
      if (items.length === 0) return;
      const wrapped = ((index % items.length) + items.length) % items.length;
      items[wrapped]?.focus({ preventScroll: true });
      indexRef.current = wrapped;
    },
    [getItems],
  );

  const stepFocused = useCallback((direction: 1 | -1) => {
    const focused = document.activeElement;
    if (!(focused instanceof HTMLElement)) return false;
    const row = focused.closest<HTMLElement>("[data-settings-row-kind]");
    if (!row) return false;

    const kind = rowKind(row);
    if (kind !== "slider" && kind !== "stepper") return false;

    const button = row.querySelector<HTMLButtonElement>(
      direction > 0 ? "[data-settings-step='up']" : "[data-settings-step='down']",
    );
    if (!button || button.disabled) return false;
    button.click();
    return true;
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !enabled) return;

    const currentIndex = () => {
      const items = getItems();
      const focused = document.activeElement;
      const index = focused ? items.indexOf(focused as HTMLElement) : -1;
      return index === -1 ? indexRef.current : index;
    };

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const current = currentIndex();
      focusIndex(event.deltaY > 0 ? current + 1 : current - 1);
    };

    const activate = (event: Event) => {
      const focused = document.activeElement;
      if (!(focused instanceof HTMLElement)) return;
      if (!container.contains(focused)) return;
      const control = focused.querySelector<HTMLElement>(
        "button, [role='switch'], [role='radio'], [role='slider']",
      );
      const target = control ?? focused;
      if (target instanceof HTMLButtonElement && target.disabled) return;
      event.preventDefault();
      target.click();
    };

    const onKeyDown = (event: KeyboardEvent) => {
      const delta = stepDelta(event.key);
      if (delta !== null) {
        if (stepFocused(delta as 1 | -1)) {
          event.preventDefault();
          return;
        }
        event.preventDefault();
        focusIndex(currentIndex() + delta);
        return;
      }
      if (event.key === "Enter" || event.key === " ") {
        activate(event);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        focusIndex(0);
      }
    };

    const onAuxClick = (event: MouseEvent) => {
      if (event.button === 1) activate(event);
    };

    const onFocusIn = () => {
      const items = getItems();
      const focused = document.activeElement;
      if (!focused || !container.contains(focused)) return;
      const index = items.indexOf(focused as HTMLElement);
      if (index !== -1) indexRef.current = index;
    };

    container.addEventListener("wheel", onWheel, { passive: false });
    container.addEventListener("keydown", onKeyDown);
    container.addEventListener("auxclick", onAuxClick);
    container.addEventListener("focusin", onFocusIn);

    if (getItems().length > 0 && !container.contains(document.activeElement)) {
      focusIndex(0);
    }

    return () => {
      container.removeEventListener("wheel", onWheel);
      container.removeEventListener("keydown", onKeyDown);
      container.removeEventListener("auxclick", onAuxClick);
      container.removeEventListener("focusin", onFocusIn);
    };
  }, [enabled, focusIndex, getItems, stepFocused]);

  return { containerRef };
}
