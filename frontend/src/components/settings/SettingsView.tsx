import { useCallback } from "react";

import { useSettingsContext } from "@/context/settings";
import { useSettingsNavigation } from "@/hooks/useSettingsNavigation";
import { planCategories } from "@/lib/settings-layout";
import { useI18n, type TranslationKey } from "@/i18n";
import type { FieldValue, SettingsCategoryId } from "@/types/settings";
import { CategoryArtworkSlot } from "./CategoryArtworkSlot";
import { CategoryRail } from "./CategoryRail";
import { SettingsPanel } from "./SettingsPanel";

/**
 * The Settings app: rail | controls | reserved artwork slot.
 *
 * This component contains no settings content. It reads the schema through the
 * context, hands it to the pure planner and renders the result, so a new setting
 * (or a whole new macrocategory) appears here with no change to this file.
 */
export function SettingsView() {
  const { t } = useI18n();
  const { categories, values, activeCategoryId, selectCategory, setValue } = useSettingsContext();
  const { containerRef } = useSettingsNavigation();

  const plan = planCategories(categories, activeCategoryId, values, (key) =>
    t(key as TranslationKey),
  );

  const handleFieldChange = useCallback(
    (fieldId: string, value: FieldValue) => {
      if (!activeCategoryId) return;
      void setValue(activeCategoryId, fieldId, value);
    },
    [activeCategoryId, setValue],
  );

  const handleSelect = useCallback(
    (categoryId: SettingsCategoryId) => selectCategory(categoryId),
    [selectCategory],
  );

  return (
    <div ref={containerRef} className="flex h-full w-full items-start gap-8">
      <CategoryRail title={plan.title} items={plan.rail} onSelect={handleSelect} />
      {plan.active ? (
        <SettingsPanel
          category={plan.active}
          onFieldChange={handleFieldChange}
          emptyLabel={t("settings.empty")}
        />
      ) : (
        <div className="flex min-w-0 flex-1 items-center justify-center self-stretch">
          <p className="text-base text-warm-100/40">{t("settings.unavailable")}</p>
        </div>
      )}
      <div className="flex h-full items-center">
        <CategoryArtworkSlot label={t("settings.placeholder")} />
      </div>
    </div>
  );
}
