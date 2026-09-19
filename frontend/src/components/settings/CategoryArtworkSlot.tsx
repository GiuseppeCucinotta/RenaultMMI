import {
  SETTINGS_ARTWORK_PLACEHOLDER,
  SETTINGS_ARTWORK_SIZE,
} from "@/constants/settings";

export interface CategoryArtworkSlotProps {
  /** Resolved placeholder text, defaulting to the literal from the design. */
  label?: string;
}

/**
 * Right column: the reserved slot for the future per-category artwork.
 *
 * Deliberately a fixed square of text only. No image is generated, drawn or
 * committed — the box exists so the real asset can drop in later without any
 * layout reflow, and it is sized from a constant so tests can assert on it.
 */
export function CategoryArtworkSlot({ label = SETTINGS_ARTWORK_PLACEHOLDER }: CategoryArtworkSlotProps) {
  return (
    <div
      role="img"
      aria-label={label}
      style={{ width: SETTINGS_ARTWORK_SIZE, height: SETTINGS_ARTWORK_SIZE }}
      className="flex shrink-0 items-center justify-center rounded-3xl border border-white/5"
    >
      <span className="text-xl tracking-[0.3em] text-warm-100/30">{label}</span>
    </div>
  );
}
