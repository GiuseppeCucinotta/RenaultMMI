import { cn } from "@/lib/utils";
import type { KeyboardEvent, ReactNode } from "react";

interface SelectableCardProps {
  children: ReactNode;
  /** Wired to the rotary encoder: Enter/Space activates, focus selects. */
  onSelect?: () => void;
  disabled?: boolean;
  className?: string;
  /** Applied when the card is the rotary selection. */
  selectedClassName?: string;
  ariaLabel?: string;
}

/**
 * The one interactive surface of the Phone view.
 *
 * The rotary encoder only moves focus; activation is Enter/Space (or a tap),
 * which matches `useRotaryNavigation`'s contract, so a card is a real
 * `<button>` rather than a div with click handlers.
 */
export function SelectableCard({
  children,
  onSelect,
  disabled = false,
  className,
  selectedClassName,
  ariaLabel,
}: SelectableCardProps) {
  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    onSelect?.();
  };

  return (
    <button
      type="button"
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={onSelect}
      onKeyDown={handleKeyDown}
      className={cn(
        "group/card relative w-full rounded-2xl border border-amber-500/20 bg-amber-950/40 text-left",
        "transition-all duration-200 outline-none",
        "focus-visible:border-amber-500/70 focus-visible:bg-amber-900/30",
        "focus:border-amber-500/70 focus:bg-amber-900/30",
        "disabled:cursor-not-allowed disabled:opacity-50",
        selectedClassName,
        className,
      )}
    >
      {children}
    </button>
  );
}
