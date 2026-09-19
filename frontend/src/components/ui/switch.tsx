import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * Amber switch used by the Settings view.
 *
 * Built on a native `<button role="switch">` rather than a new Radix package:
 * the repo already has plenty of primitives, and a real button keeps rotary and
 * keyboard focus behaviour (Enter/Space) identical to every other control.
 * `aria-checked` is exposed on the DOM node so `useRotaryNavigation` can pick it
 * up through the `[role='switch']` selector.
 */
function Switch({
  className,
  checked,
  ...props
}: Omit<React.ComponentProps<"button">, "role" | "aria-checked"> & {
  checked: boolean
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      data-slot="switch"
      data-state={checked ? "checked" : "unchecked"}
      className={cn(
        "relative inline-flex h-8 w-14 shrink-0 items-center rounded-full border transition-colors duration-200",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-warm-500/80 focus-visible:ring-offset-2 focus-visible:ring-offset-black/60",
        "disabled:cursor-not-allowed disabled:opacity-40",
        checked
          ? "border-warm-500/60 bg-warm-500"
          : "border-white/15 bg-[#09090B]/60",
        className,
      )}
      {...props}
    >
      <span
        aria-hidden="true"
        className={cn(
          "pointer-events-none block size-6 rounded-full bg-warm-50 shadow-sm transition-transform duration-200",
          checked ? "translate-x-7" : "translate-x-1",
        )}
      />
    </button>
  )
}

export { Switch }
