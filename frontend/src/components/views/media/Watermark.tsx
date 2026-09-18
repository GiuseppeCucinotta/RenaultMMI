import type { WatermarkProps } from "@/types/media";
import { useLayoutEffect, useRef, useState } from "react";
import { motion } from "framer-motion";

const REFERENCE_FONT_SIZE = 275;
const MAX_HEIGHT_FACTOR = 1.0;

function useWatermarkFontSize(text: string) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const [fontSize, setFontSize] = useState(REFERENCE_FONT_SIZE);

  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    const el = textRef.current;
    if (!wrap || !el || !text) return;

    const measure = () => {
      const wrapWidth = wrap.clientWidth;
      const wrapHeight = wrap.clientHeight;
      if (wrapWidth <= 0 || wrapHeight <= 0) return;

      el.style.fontSize = `${REFERENCE_FONT_SIZE}px`;
      const measured = el.offsetWidth;
      const widthFit =
        measured > 0 ? (wrapWidth / measured) * REFERENCE_FONT_SIZE : REFERENCE_FONT_SIZE;
      const size = Math.min(widthFit, wrapHeight * MAX_HEIGHT_FACTOR);
      setFontSize(Math.max(8, Math.floor(size)));
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(wrap);
    return () => observer.disconnect();
  }, [text]);

  return { wrapRef, textRef, fontSize };
}

export function Watermark({ artistName }: WatermarkProps) {
  const { wrapRef, textRef, fontSize } = useWatermarkFontSize(artistName);

  return (
    <motion.div
      ref={wrapRef}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 1, ease: "easeOut", delay: 0.5 }}
      className="pointer-events-none absolute inset-0 z-0 flex select-none items-center justify-center overflow-hidden px-10"
      aria-hidden="true"
    >
      <span
        ref={textRef}
        className="inline-block max-w-full whitespace-nowrap text-transparent uppercase tracking-[0.04em] font-bold leading-none opacity-30 [-webkit-text-fill-color:transparent] [-webkit-text-stroke:2px_var(--warm-600)]"
        style={{ fontSize }}
      >
        {artistName}
      </span>
    </motion.div>
  );
}
