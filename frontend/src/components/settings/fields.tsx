/**
 * One small component per `FieldKind`, plus the kind -> component switch.
 *
 * These are intentionally dumb: each receives a `PlannedField` (already resolved
 * label/help/value/options) and an `onChange`, and knows nothing about
 * categories, schemas or the service. Adding a new setting is therefore a
 * backend-only change; adding a new *kind* is one addition to {@link FieldRenderer}.
 *
 * Every row wraps its control in a `[data-settings-focusable]` element carrying
 * `data-settings-row-kind`, which is the contract `useSettingsNavigation` reads:
 * arrows adjust `slider`/`stepper` rows and move focus everywhere else.
 */

import type { ReactNode } from "react";
import { Minus, Plus } from "lucide-react";

import { cn } from "@/lib/utils";
import { Segmented } from "@/components/ui/segmented";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import type { PlannedField } from "@/lib/settings-layout";
import type {
  FieldDef,
  SelectField,
  SliderField,
  StepperField,
  ToggleField,
} from "@/types/settings";

export interface FieldProps<T extends FieldDef> {
  planned: PlannedField & { field: T };
  onChange: (value: T["default"]) => void;
}

/**
 * Shared row chrome: focus target, label, help text and the control slot.
 *
 * The row is `tabIndex={0}` so the wheel can focus it; clicking it bubbles to
 * the control, so pointer users never have to aim at a 32px switch.
 */
function FieldRow({
  planned,
  label,
  help,
  control,
  controlClassName,
}: {
  planned: PlannedField;
  label: string;
  help?: string;
  control: ReactNode;
  controlClassName?: string;
}) {
  return (
    <div
      data-settings-focusable
      data-settings-field={planned.field.id}
      data-settings-row-kind={planned.field.kind}
      tabIndex={0}
      className={cn(
        "flex items-center justify-between gap-6 rounded-2xl py-2",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-warm-500/70",
        planned.field.readOnly && "opacity-45",
      )}
    >
      <div className="min-w-0">
        <p className="truncate text-base tracking-wide text-warm-50">{label}</p>
        {help ? <p className="truncate text-sm text-warm-100/50">{help}</p> : null}
      </div>
      <div className={cn("flex shrink-0 items-center gap-3", controlClassName)}>{control}</div>
    </div>
  );
}

function ToggleControl({ planned, onChange }: FieldProps<ToggleField>) {
  const { field, value, label, help } = planned;
  const checked = value === true;
  const disabled = field.readOnly === true;

  return (
    <FieldRow
      planned={planned}
      label={label}
      help={help}
      control={
        <Switch
          checked={checked}
          disabled={disabled}
          aria-label={label}
          onClick={() => {
            if (!disabled) onChange(!checked);
          }}
        />
      }
    />
  );
}

function formatValue(field: SliderField | StepperField, value: number): string {
  return field.unitKey ? `${value} ${field.unitKey}` : String(value);
}

function SliderControl({ planned, onChange }: FieldProps<SliderField>) {
  const { field, value, label, help } = planned;
  const numeric = typeof value === "number" ? value : field.default;
  const disabled = field.readOnly === true;

  return (
    <FieldRow
      planned={planned}
      label={label}
      help={help}
      controlClassName="w-64"
      control={
        <>
          <NumericStepButton
            label={label}
            direction="down"
            srOnly
            disabled={disabled || numeric <= field.min}
            onClick={() => onChange(Math.max(field.min, numeric - field.step))}
          />
          <Slider
            value={[numeric]}
            min={field.min}
            max={field.max}
            step={field.step}
            disabled={disabled}
            aria-label={label}
            aria-valuetext={formatValue(field, numeric)}
            onValueChange={([next]) => onChange(next)}
            className="flex-1"
            trackClassName="bg-white/10 h-1.5"
            rangeClassName="bg-warm-500"
            thumbClassName="border-warm-500 bg-warm-50 size-4"
          />
          <span className="w-12 text-right text-sm text-warm-50 [font-variant-numeric:tabular-nums]">
            {formatValue(field, numeric)}
          </span>
          <NumericStepButton
            label={label}
            direction="up"
            srOnly
            disabled={disabled || numeric >= field.max}
            onClick={() => onChange(Math.min(field.max, numeric + field.step))}
          />
        </>
      }
    />
  );
}

function SelectControl({ planned, onChange }: FieldProps<SelectField>) {
  const { field, value, label, help } = planned;
  const selected = typeof value === "string" ? value : field.default;

  return (
    <FieldRow
      planned={planned}
      label={label}
      help={help}
      control={
        <Segmented
          aria-label={label}
          value={selected}
          disabled={field.readOnly === true}
          // Labels are resolved by the planner, so an untranslated option
          // degrades to its id instead of surfacing a raw key.
          options={
            planned.options ??
            field.options.map((option) => ({ value: option.value, label: option.value }))
          }
          onChange={onChange}
        />
      }
    />
  );
}

function NumericStepButton({
  label,
  direction,
  disabled,
  onClick,
  srOnly = false,
}: {
  label: string;
  direction: "up" | "down";
  disabled: boolean;
  onClick: () => void;
  /** Sliders hide their stepping buttons: the arrow-key path is invisible. */
  srOnly?: boolean;
}) {
  const Icon = direction === "up" ? Plus : Minus;
  return (
    <button
      type="button"
      data-settings-step={direction}
      disabled={disabled}
      aria-label={`${label} ${direction}`}
      onClick={onClick}
      className={cn(
        "items-center justify-center rounded-full border border-white/10 text-warm-100",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-warm-500/80",
        "disabled:cursor-not-allowed disabled:opacity-30",
        srOnly ? "hidden" : "flex size-8",
      )}
    >
      <Icon className="size-4" />
    </button>
  );
}

function StepperControl({ planned, onChange }: FieldProps<StepperField>) {
  const { field, value, label, help } = planned;
  const numeric = typeof value === "number" ? value : field.default;
  const disabled = field.readOnly === true;

  const step = (direction: -1 | 1) => {
    const next = Math.min(field.max, Math.max(field.min, numeric + direction * field.step));
    if (next !== numeric) onChange(next);
  };

  return (
    <FieldRow
      planned={planned}
      label={label}
      help={help}
      control={
        <>
          <NumericStepButton
            label={label}
            direction="down"
            disabled={disabled || numeric <= field.min}
            onClick={() => step(-1)}
          />
          <span className="w-14 text-center text-base text-warm-50 [font-variant-numeric:tabular-nums]">
            {formatValue(field, numeric)}
          </span>
          <NumericStepButton
            label={label}
            direction="up"
            disabled={disabled || numeric >= field.max}
            onClick={() => step(1)}
          />
        </>
      }
    />
  );
}

/** Defensive row for a `kind` this build does not know yet. */
function UnsupportedControl({ planned }: { planned: PlannedField }) {
  return (
    <FieldRow
      planned={planned}
      label={planned.label}
      help={planned.help}
      control={<span className="text-sm text-warm-100/50">{planned.field.kind}</span>}
    />
  );
}

export function FieldRenderer({
  planned,
  onChange,
}: {
  planned: PlannedField;
  onChange: (value: boolean | number | string) => void;
}) {
  switch (planned.field.kind) {
    case "toggle":
      return (
        <ToggleControl planned={planned as FieldProps<ToggleField>["planned"]} onChange={onChange} />
      );
    case "slider":
      return (
        <SliderControl planned={planned as FieldProps<SliderField>["planned"]} onChange={onChange} />
      );
    case "select":
      return (
        <SelectControl planned={planned as FieldProps<SelectField>["planned"]} onChange={onChange} />
      );
    case "stepper":
      return (
        <StepperControl planned={planned as FieldProps<StepperField>["planned"]} onChange={onChange} />
      );
    default:
      return <UnsupportedControl planned={planned} />;
  }
}
