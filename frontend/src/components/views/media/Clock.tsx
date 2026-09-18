import { useEffect, useState } from "react";

function formatClock(date: Date): string {
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

export function Clock() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);

  return (
    <time
      className="absolute right-0 top-1/2 -translate-y-1/2 whitespace-nowrap text-[34px] font-normal tabular-nums tracking-[0.06em] text-warm-100"
      dateTime={now.toISOString()}
    >
      {formatClock(now)}
    </time>
  );
}
