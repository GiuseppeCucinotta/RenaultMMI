import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { useI18n, type TranslationKey } from "@/i18n";
import type { NavId } from "@/types/navigation";

import homeIcon from "@/assets/icons/views/home.svg";
import phoneIcon from "@/assets/icons/views/smartphone.svg";
import mediaIcon from "@/assets/icons/views/music.svg";

interface NavbarProps {
  className?: string;
  activeId: NavId;
  onNavigate: (id: NavId) => void;
  onGearScroll?: (direction: "up" | "down") => void;
}

const navItems: { id: NavId; icon: string; labelKey: TranslationKey }[] = [
  { id: "home", icon: homeIcon, labelKey: "nav.home" },
  { id: "phone", icon: phoneIcon, labelKey: "nav.phone" },
  { id: "media", icon: mediaIcon, labelKey: "nav.media" },
];

export function Navbar({ className, activeId, onNavigate, onGearScroll }: NavbarProps) {
  const { t } = useI18n();
  const navRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = navRef.current;
    if (!el || !onGearScroll) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      onGearScroll(e.deltaY > 0 ? "down" : "up");
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [onGearScroll]);

  return (
    <nav
      ref={navRef}
      className={cn(
        "flex flex-col items-center justify-center w-24 h-auto",
        "rounded-full border border-white/10",
        "bg-[#09090B]/20 backdrop-blur-sm",
        className
      )}
    >
      <div className="flex flex-col gap-15 w-full items-center">
        {navItems.map((item) => {
          const isActive = activeId === item.id;

          return (
            <button
              key={item.id}
              onClick={() => onNavigate(item.id)}
              className={cn(
                "relative group flex items-center justify-center w-16 h-14 transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-warm-500/80 focus-visible:ring-offset-2 focus-visible:ring-offset-black/60 rounded-full",
              )}
            >
              
              {isActive && (
                <div className="absolute inset-0 bg-amber-500/20 blur-xl rounded-full opacity-50" />
              )}
              
              <img 
                src={item.icon} 
                alt={t(item.labelKey)}
                className={cn(
                  "relative  z-10 transition-all duration-300 w-12 h-12 object-contain", 
                  isActive ? "scale-110 drop-shadow-[0_0_8px_rgba(245,158,11,0.5)]" : "opacity-50"
                )}
              />
            </button>
          );
        })}
      </div>
    </nav>
  );
}
