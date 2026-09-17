import phoneImage from "@/assets/phone.webp";
import { cn } from "@/lib/utils";

interface BluetoothArtworkProps {
  className?: string;
  alt: string;
}

/**
 * The hero phone render from the design, with the amber bloom behind it.
 *
 * The source asset is a rectangular render on a light background, so it is
 * blended with `screen` and given a soft drop shadow instead of being clipped.
 */
export function BluetoothArtwork({ className, alt }: BluetoothArtworkProps) {
  return (
    <div className={cn("relative flex items-center justify-center", className)}>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-full bg-amber-500/25 blur-[70px]"
      />
      <img
        src={phoneImage}
        alt={alt}
        draggable={false}
        className="relative h-full w-auto max-w-none select-none object-contain mix-blend-screen drop-shadow-[0_0_34px_rgba(245,158,11,0.45)]"
      />
    </div>
  );
}
