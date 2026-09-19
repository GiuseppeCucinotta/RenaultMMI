import type { PlannedCategory } from "@/lib/settings-layout";
import type { FieldValue } from "@/types/settings";
import { FieldRenderer } from "./fields";

export interface SettingsPanelProps {
  category: PlannedCategory;
  onFieldChange: (fieldId: string, value: FieldValue) => void;
  /** Resolved "no settings yet" message. */
  emptyLabel: string;
}

/**
 * Center column: the settings themselves.
 *
 * Purely a renderer for the planner's output — it iterates groups and fields and
 * never inspects a `kind`, an id or a label. It deliberately prints **no
 * heading**: the only title on screen is the section header in the left column,
 * so switching category does not swap a title in and out.
 *
 * An empty category shows a message instead of an empty divider, which is what
 * keeps a not-yet-populated macrocategory from looking broken.
 */
export function SettingsPanel({ category, onFieldChange, emptyLabel }: SettingsPanelProps) {
  return (
    <section className="flex min-h-0 min-w-0 flex-1 self-stretch">
      {category.empty ? (
        <p className="self-center text-base text-warm-100/40">{emptyLabel}</p>
      ) : (
        <>
          <span aria-hidden="true" className="w-px shrink-0 self-stretch bg-white/10" />
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pl-8 pr-2">
            {category.groups.map((group) => (
              <div key={group.id} className="flex flex-col">
                {group.label ? (
                  <p className="mb-1 text-xs uppercase tracking-[0.2em] text-warm-100/40">
                    {group.label}
                  </p>
                ) : null}
                {group.fields.map((planned) => (
                  <FieldRenderer
                    key={planned.field.id}
                    planned={planned}
                    onChange={(value) => onFieldChange(planned.field.id, value)}
                  />
                ))}
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
