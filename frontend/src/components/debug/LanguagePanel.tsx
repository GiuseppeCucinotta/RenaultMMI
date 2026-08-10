import { Languages } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n, type Locale } from "@/i18n";

const LANGUAGE_OPTIONS: { value: Locale; label: string }[] = [
  { value: "en", label: "English" },
  { value: "it", label: "Italiano" },
];

export function LanguagePanel() {
  const { locale, setLocale } = useI18n();

  return (
    <section className="rounded-[20px] border border-white/10 bg-black/20 backdrop-blur-md p-6 space-y-4">
      <div className="flex items-center gap-3">
        <Languages className="w-5 h-5 text-warm-300" strokeWidth={2} />
        <h2 className="text-xs uppercase tracking-widest text-warm-100 font-semibold">Language</h2>
      </div>

      <div className="flex items-center gap-2">
        {LANGUAGE_OPTIONS.map((option) => {
          const isSelected = locale === option.value;
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => setLocale(option.value)}
              className={cn(
                "flex items-center gap-2 px-4 py-2 rounded-lg border text-sm transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-warm-500/80",
                isSelected
                  ? "border-warm-500/60 bg-warm-500/15 text-warm-200"
                  : "border-white/10 bg-white/5 text-white/60 hover:bg-white/10",
              )}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </section>
  );
}
