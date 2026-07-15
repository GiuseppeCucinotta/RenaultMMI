import type { LucideIcon } from "lucide-react";

interface PlaceholderViewProps {
  icon: LucideIcon;
  label: string;
}

export function PlaceholderView({ icon: Icon, label }: PlaceholderViewProps) {
  return (
    <div className="flex flex-1 items-center justify-center h-full">
      <div className="flex flex-col items-center gap-3 text-white/30">
        <Icon className="w-12 h-12" />
        <p className="text-base font-medium tracking-wide">{label}</p>
      </div>
    </div>
  );
}
