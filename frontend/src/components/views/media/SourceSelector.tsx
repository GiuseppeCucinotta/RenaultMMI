import { Bluetooth, Disc, Disc3, Music2, Radio, type LucideIcon } from "lucide-react";
import type { SourceSelectorProps } from "@/types/media";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useI18n, getMessage, type TranslationKey } from "@/i18n";

const ICONS: Record<string, LucideIcon> = {
  bluetooth: Bluetooth,
  cd: Disc3,
  fm: Radio,
  jukebox: Disc,
};

function sourceLabelKey(id: string): TranslationKey {
  return `media.sources.${id}` as TranslationKey;
}

export function SourceSelector({ feed, onSelectSource }: SourceSelectorProps) {
  const { sources, selectedSourceId } = feed;
  const { t, locale } = useI18n();

  return (
    <div
      className="flex items-center gap-1.5 rounded-full bg-warm-950/20 p-2 backdrop-blur"
      role="tablist"
      aria-label={t("media.audioSourcesAria")}
    >
      {sources.map((source) => {
        const Icon = ICONS[source.iconKey] ?? Music2;
        const isSelected = source.id === selectedSourceId;
        const label = getMessage(locale, sourceLabelKey(source.id)) ?? source.name;

        return (
          <Button
            key={source.id}
            type="button"
            role="tab"
            aria-selected={isSelected}
            variant="ghost"
            className={cn(
              "h-auto rounded-full px-8 py-3.5 text-[18px] font-semibold uppercase tracking-[0.08em] text-warm-500 hover:bg-transparent hover:text-warm-300 active:scale-95",
              isSelected &&
                "bg-warm-500 text-warm-950 shadow-[0_0_18px_rgba(245,158,11,0.35)] hover:bg-warm-500 hover:text-warm-950",
            )}
            onClick={() => onSelectSource?.(source.id)}
          >
            <Icon className="size-7 shrink-0" aria-hidden="true" />
            <span>{label}</span>
          </Button>
        );
      })}
    </div>
  );
}
