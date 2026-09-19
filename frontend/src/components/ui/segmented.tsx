import { cn } from "@/lib/utils";

export interface SegmentedOption {
  value: string;
  label: string;
}

export interface SegmentedProps {
  value: string;
  options: SegmentedOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
  "aria-label"?: string;
}

/**
 * Segmented single-choice control.
 *
 * Chosen over a Radix dropdown because it is fully operable by rotary-only
 * input: every option is its own focusable `role="radio"` element, so the wheel
 * steps through choices with no popover to trap focus in, and the whole row
 * stays visible on the 1920x480 portrait screen.
 */
export function Segmented({
  value,
  options,
  onChange,
  disabled,
  className,
  "aria-label": ariaLabel,
}: SegmentedProps) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border border-white/10 bg-[#09090B]/40 p-1",
        className,
      )}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled}
            onClick={() => onChange(option.value)}
            className={cn(
              "rounded-full px-4 py-1.5 text-sm transition-colors duration-200",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-warm-500/80 focus-visible:ring-offset-2 focus-visible:ring-offset-black/60",
              "disabled:cursor-not-allowed disabled:opacity-40",
              selected
                ? "bg-warm-500 text-black"
                : "text-warm-100/70 hover:text-warm-100",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
