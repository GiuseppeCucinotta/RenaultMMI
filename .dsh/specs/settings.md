# Settings — Implementation Spec

Status: **ready to implement**. This document is the single source of truth for the Settings feature.
Read it top to bottom before writing code. It replaces the earlier prose description of the same file.

> **Ordering note.** Sections 1–3 are contracts; §4–§10 are the work. The design reference is
> `.dsh/specs/Settings.png` (1920×480), reproduced by `.cache/spec-crops/{left,center,right}.png`.

---

## 1. Objective

Ship a **Settings app** that is a *deep module*: a large amount of settings behaviour behind a small,
stable interface. Concretely, three deliverables:

1. **A frontend skeleton that adapts its layout automatically** to settings that do not exist yet. No
   settings content is hardcoded in the renderer; the UI is a pure function of a registry.
2. **A `settings-service/` backend** that partitions settings into the five fixed macrocategories. Each
   category is a self-contained plugin. Adding a setting must touch exactly one category module.
3. **Tests** proving (a) the frontend adapts to arbitrary schemas and (b) the backend is first-class
   design software that accepts new settings without modification.

> **Not yet in scope:** inventing real vehicle features. The five categories ship empty except for a
> minimal demo entry set (§6.4) that makes the adaptive layout observable. No placeholder *content* is
> invented — only a throwaway *test* category (§9.3).

### 1.1 Definition of done

`cd frontend && npm test && npm run lint && npm run build` all pass. No new runtime dependency is added
(no jsdom, no testing-library, no state library). `AGENTS.md` §5.7 rules apply unchanged.

---

## 2. The five macrocategories (fixed)

These ids are **fixed and centralized**. They are the only categories that ship in the product. Their
order in the left category list is exactly this order, top to bottom:

| id | Category label (`en` / `it`) |
| --- | --- |
| `vehicle` | Vehicle / Veicolo |
| `audio` | Audio / Audio |
| `connectivity` | Connectivity / Connettività |
| `display` | Display / Display |
| `system` | System / Sistema |

Categories are presented as **plain text** — no icons, no container, no pill. The single header for the
whole section sits above them and is the i18n key `settings.title` (`Settings` / `Impostazioni`). In the
reference screenshot that header reads "Impostazioni"; follow the app's locale, not the screenshot's.

Each category still declares `titleKey` and `icon` in its `CategoryDef` so the schema keeps that
information, but the current design renders neither: the `titleKey` is redundant with `labelKey` and the
icon is unused. They are **not** part of the render contract — do not reintroduce a per-category heading
or an icon list without changing this spec.

---

## 3. Non-negotiable invariants

These are the properties the tests exist to protect. Breaking one is a bug, not a tradeoff.

- **I1 — Adaptive layout.** The renderer contains **no** reference to any category id, setting id, label,
  control kind or option list. Adding a setting (or a whole category) is a **backend-only** change: no
  `.tsx` file is edited. The only exception is the fixed rail ordering list in §2, which is data.
- **I2 — Category independence.** No setting may depend on, read, override or be validated against a
  setting in another category. Cross-category references are rejected **at registration time** (throw),
  and a test proves the rejection.
- **I3 — Same-category dependencies only.** A field may declare `showWhen`, referencing fields **of its
  own category**. This is the *only* permitted dependency mechanism, and it is one-directional.
- **I4 — Validation is shared, and the backend is authoritative.** The frontend may use the schema to
  disable/limit controls, but the backend re-validates every write and is the only source of truth.
- **I5 — No system/master volume.** Settings never touch system volume (§12 of `AGENTS.md`). In
  particular the Audio category must not duplicate `EntertainmentVolumeController`.
- **I6 — Category isolation at rest.** Each category's persisted values are independent: a corrupt or
  missing blob for one category must not prevent the other four from loading.
- **I7 — Errors use the existing convention.** Handlers `throw new HttpError(...)`; they never write an
  error body. Unknown route → 404, wrong method → 405, invalid JSON → 400.
- **I8 — Portrait-safe.** The whole view fits 1920×480 with no horizontal overflow and no vertical
  scrolling of the page; the center panel scrolls internally only if its schema overflows.

---

## 4. Design reference (measured)

Three columns on a 1920×480 amber-950 stage. The global `Navbar` and `Background` stay as they are.

```
┌──────────────────────────────────────────────────────────────────────────────────────┐
│      Settings                                        ┌───────────────┐  ┌──────────┐ │
│      Vehicle                                         │ ( ) Setting 1 │  │          │ │
│      Audio                                           └───────────────┘  │  PLACE   │ │
│      Connectivity                     ┆              ┌───────────────┐  │  HOLDER  │ │
│      Display                          ┆              │ ( ) Setting 2 │  │          │ │
│      System                           ┆              └───────────────┘  └──────────┘ │
│   list ⌁240px                  center (flex, largest)              right (420×420)   │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

- **Left.** The **one** header for the whole section (`settings.title`) at the top, then the five
  categories from §2 as **plain text lines** — no icons, no container, no pill. The selected line is the
  only amber item (`text-warm-500`, medium weight, soft glow); the rest are `text-warm-100/60` that
  brightens on hover. Selection is conveyed by color/weight alone, so it must stay legible in both
  locales. Each line is a real `<button>` so rotary focus and `aria-current` work (§8).
  Header and list are top-aligned, not vertically centered.
- **Left sizing.** The header is `text-3xl` and the category lines are `text-2xl` (24px), which is what
  the reference uses — measured, its "Connettività" is 144px wide on the 1920px stage. The rail column is
  **240px**, sized for the longest localized label; labels are `whitespace-nowrap`, because a wrapped
  category name breaks the scannable column the reference relies on. The nav fills the viewport height
  (`h-full`) and distributes the lines with `justify-around` inside a `flex-1` list, so the categories
  spread across the available space instead of clustering at the top. Add a category only if it fits
  that column at `text-2xl` — widen the rail or drop the size rather than letting a label wrap.
- **Center.** Controls only: a **1px vertical divider** (`bg-white/10`) as the first element, then the
  control list. There is deliberately **no per-category heading here** — the single title lives in the
  left column, so switching category never swaps a title. The controls in the reference are toggles; a
  toggle in the "on" state is amber-500 track with a warm-50 knob. The divider is omitted when the
  category renders no controls; the empty message is shown instead.
- **Right.** Exactly one reserved slot: a **420×420 box, vertically centered**, containing the literal
  text `PLACEHOLDER`, uppercase, tracked out, low-emphasis color, horizontally and vertically centered.
  It reserves the size of the future per-category asset. **Do not** generate, draw, or commit any
  placeholder image, and do not use `modus_wireframe.png` here — the reference's car render is a
  *sample asset*, positioned by `.cache/spec-crops/right.png`, not part of this deliverable.
- **Palette/typography.** `warm-*` tokens and the Chakra Petch stack only, per `DESIGN.md`. Uppercase
  tracked-out headers for labels; monospaced treatment for numeric readouts where a value is shown.

---

## 5. Architecture

Fits the existing three-service pattern exactly (`AGENTS.md` §3, §5.3, §8 "Add a service").

```
┌─────────────────────────────────────────────────────────────────────┐
│ Electron main (electron/main.ts)                                    │
│   • spawns settings-service (ELECTRON_RUN_AS_NODE), like the others │
│   • IPC: settings:get-endpoint → { baseUrl }                        │
└──────────────────────────┬──────────────────────────────────────────┘
                           │ IPC (preload: window.settings.getEndpoint)
                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│ React renderer                                                      │
│   SettingsView → useSettings → src/services/settings.ts             │
│   ← HTTP + SSE → 127.0.0.1:4400                                     │
└──────────────────────────┬──────────────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────────────┐
│ settings-service/  :4400 (SETTINGS_PORT)                            │
│   extends BaseMediaService<SettingsState> (shared/service-http.ts)  │
│   registry → categories → store (~/.config/renault-mmi/settings.json)│
└─────────────────────────────────────────────────────────────────────┘
```

**Why the backend is a service and not the existing `/api/settings` routes.** Every service already
exposes `GET/POST /api/settings` from `BaseMediaService` for *process lifecycle* (`autoSuspend`,
`idleTimeoutMs`, `suspended`). That name is taken and must not be overloaded. The user-facing settings
live on the new service under `category`-scoped routes (§6.3). Keep the base contract untouched.

The settings service owns no hardware and holds no audio: it is a schema + store service, so it is
always safe to suspend/auto-suspend it and it never reports `isBusy() === true`.

---

## 6. Backend contract — `settings-service/`

### 6.1 Files

| File | Responsibility |
| --- | --- |
| `settings-service/types.ts` | `FieldKind`, `FieldDef`, `CategoryDef`, `SettingsValues`, `SettingsState` |
| `settings-service/fields.ts` | Field validation + normalisation, `showWhen` evaluation (pure, no I/O) |
| `settings-service/registry.ts` | `CATEGORY_ORDER`, `createRegistry(categories)`, cross-category rejection |
| `settings-service/store.ts` | Load/save `SettingsStore`, per-category isolation, atomic write |
| `settings-service/categories/vehicle.ts` | The five modules; each exports one `CategoryDef` |
| `settings-service/categories/audio.ts` | … |
| `settings-service/categories/connectivity.ts` | … |
| `settings-service/categories/display.ts` | … |
| `settings-service/categories/system.ts` | … |
| `settings-service/service.ts` | `SettingsService extends BaseMediaService<SettingsState>` + routes |
| `settings-service/config.ts` | `SETTINGS_PORT`, `SETTINGS_STORE_PATH` (mirrors `jukebox-service/config.ts`) |
| `settings-service/index.ts` | Entry: `resolveConfig()` → `new SettingsService(...)` → `start()` |

**Adding a setting = edit one file in `categories/`.** Nothing else. If a change requires a second
backend file, the abstraction is wrong — fix the abstraction, not the spec.

### 6.2 Schema types

```ts
export type FieldKind = "toggle" | "slider" | "select" | "stepper";

/** A predicate over the *same category's* values. Pure and serialisable. */
export interface ShowWhen {
  field: string;                     // must exist in the same category
  equals?: string | number | boolean;
  notEquals?: string | number | boolean;
  /** Optional numeric comparison, for "only above N" style gates. */
  greaterThan?: number;
  lessThan?: number;
}

interface FieldBase {
  id: string;                        // unique within the category
  labelKey: string;                  // i18n key, e.g. "settings.audio.balance"
  helpKey?: string;                  // optional secondary line
  kind: FieldKind;
  default: FieldValue;
  /** Omit for a writable field; `true` renders read-only and rejects writes (I7). */
  readOnly?: boolean;
  showWhen?: ShowWhen;               // same-category only (I3)
}

export interface ToggleField extends FieldBase { kind: "toggle"; default: boolean }
export interface SliderField extends FieldBase {
  kind: "slider"; default: number;
  min: number; max: number; step: number; unitKey?: string;
}
export interface SelectField extends FieldBase {
  kind: "select"; default: string;
  options: { value: string; labelKey: string }[];
}
export interface StepperField extends FieldBase {
  kind: "stepper"; default: number;
  min: number; max: number; step: number; unitKey?: string;
}
export type FieldDef = ToggleField | SliderField | SelectField | StepperField;
export type FieldValue = boolean | number | string;

export interface CategoryDef {
  id: SettingsCategoryId;            // "vehicle" | … | string (tests add a 6th)
  labelKey: string;                  // "$settings.category.vehicle" → see §7.2
  titleKey: string;
  icon: CategoryIcon;                // { kind: "asset"; src: string } | { kind: "lucide"; name: string }
  /** Optional grouping inside the center column; ungrouped fields get one implicit group. */
  groups?: { id: string; labelKey?: string; fields: FieldDef[] }[];
  fields: FieldDef[];                // merged view used for validation/planning
}

export interface SettingsState {
  categories: CategoryDef[];                    // ordered per §2
  values: Record<string, SettingsValues>;       // categoryId → fieldId → value
}
```

`SettingsValues = Record<string, FieldValue>`.

### 6.3 Routes

Built-in from `BaseMediaService`: `GET /api/health`, `GET /api/state`, `GET /api/events`,
`GET|POST /api/settings` (lifecycle — unchanged). Service-specific, all under `category` scope:

| Method & path | Body | Success | Failure |
| --- | --- | --- | --- |
| `GET /api/categories` | — | `{ categories: CategorySummary[] }` — schema only, **no values** | — |
| `GET /api/values` | — | `{ values: Record<categoryId, SettingsValues> }` | — |
| `GET /api/values/:categoryId` | — | `{ categoryId, values }` | unknown id → `404` |
| `PATCH /api/values/:categoryId` | `{ values: SettingsValues }` partial | `{ categoryId, values }` (full, normalised) | see §6.5 |
| `POST /api/values/:categoryId/reset` | — | `{ categoryId, values }` = schema defaults | unknown id → `404` |

`CategorySummary` = the `CategoryDef` minus `default` handling; it **must** carry everything the
renderer needs to draw the form (`id`, `labelKey`, `groups`, `fields` with all constraints). `titleKey`
and `icon` are carried too but are not rendered today (§2). Do not require a second round-trip to render
controls (I1).

Mutating handlers already get `onActivity()` + auto-resume from the base class, so a PATCH on a
suspended service wakes it — that is intended, not a bug to work around.

### 6.4 Registry rules

- `CATEGORY_ORDER` in `registry.ts` is the single source of the five ids and their order (§2). It is
  **data**, and it is the *only* place in the codebase that names them (I1).
- `createRegistry(categories)` validates on construction and **throws** `HttpError`-free `Error`s (a
  programming error, surfaced at boot and in tests, not a request error) when:
  - duplicate category id or duplicate field id within a category,
  - a `showWhen.field` that does not exist in the same category (**I2/I3**),
  - a `default` outside `min`/`max`, or not in `options`,
  - a `min > max`, `step <= 0`, empty `options`.
- The five shipped categories start with a minimal demo set that exercises each control kind, so the
  adaptive layout is visibly real. Keep them clearly trivial and non-functional (e.g. a `vehicle`
  toggle, an `audio` slider, a `system` read-only select). **No invented vehicle semantics, no
  cross-category coupling, no real actuator wiring.** These are placeholders for real settings and are
  expected to be replaced wholesale later.

### 6.5 Validation rules (backend is authoritative, I4/I7)

For `PATCH /api/values/:categoryId`:

1. Unknown category → `404`.
2. Missing / non-object `values` → `400`.
3. Unknown field id → `400` (naming the field). Never silently drop.
4. `readOnly` field present → `400` (naming the field).
5. Wrong type for `kind` → `400` (`toggle` ⇒ boolean; `slider`/`stepper` ⇒ finite number; `select` ⇒
   string).
6. Out of `min`/`max` → `400` for **both** `slider` and `stepper`. Never clamp a write: a caller must not
   be able to learn that `42` became `10`. A `slider` value that lands *between* steps is snapped to the
   nearest step (a slider track legitimately produces those); a `stepper` value off the lattice → `400`.
7. `select` value not in `options` → `400`.
8. Updates are **partial and merged**: omitted fields keep their stored values, then the result is
   re-normalised against the schema. The response is always the **full** category value set.
9. A field whose `showWhen` is currently false is **still writable** (the user may pre-set it), but it is
   not rendered. Validation must never reject a write *because* it is hidden.
10. Writes persist through `store.ts` before responding; a failed save is a `500` and changes nothing.

### 6.6 Persistence — `$SETTINGS_STORE_PATH`

- Default `~/.config/renault-mmi/settings.json`; overridable by env (`config.ts`, same style as
  `jukebox-service/config.ts`). Tests always pass a temp path.
- Shape: `{ "version": 1, "categories": { "<categoryId>": { "<fieldId>": value } } }`.
- **I6 enforcement:** load is per category. A malformed/unreadable category blob → that category falls
  back to schema defaults and logs a warning; the other four load normally. A malformed *file* is
  treated as "every category is at defaults", never a crash.
- Missing file = all defaults. Stored values for fields that no longer exist are dropped on load, not
  preserved, and their removal is persisted on the next write.
- On load, stored values are re-normalised against the schema (type, range, options) so an edited
  schema can never produce an invalid live value. Distinct from a write: an out-of-range *stored* value
  is replaced by that field's default with a warning, whereas an out-of-range *write* is rejected (§6.5).
- Write atomically: `write tmp` → `rename`, exactly like `jukebox-service/scanner.ts:239`.
- The store is a class with an injected path + logger so tests construct it directly with no service.

---

## 7. Frontend contract

### 7.1 Files

| File | Responsibility |
| --- | --- |
| `src/types/settings.ts` | Mirror of §6.2 types (renderer-side; **no** imports from `settings-service/`) |
| `src/services/settings.ts` | `getSettingsEndpoint`, `fetchSettingsCategories`, `fetchSettingsValues`, `patchSettingsValues`, `resetSettingsCategory`; default `http://127.0.0.1:4400`, `checkServiceHealth` reuse |
| `src/lib/settings-layout.ts` | **Pure.** `planCategories(categories, categoryId, values)` → resolved render model (§7.3). Unit-tested. |
| `src/hooks/useSettings.ts` | Mirror `useJukebox.ts`: `mode: "service" \| "mock" \| "loading"`, health probe + SSE subscribe, `setValue`, `resetCategory`. Never throws into render. |
| `src/context/settings.ts` + `SettingsProvider.tsx` | Provider/context pair exactly like the bluetooth/cd/jukebox trio |
| `src/components/settings/SettingsView.tsx` | Three-column shell (§4) |
| `src/components/settings/CategoryRail.tsx` | Left column; receives categories + active id + onSelect |
| `src/components/settings/SettingsPanel.tsx` | Center column; renders the plan |
| `src/components/settings/CategoryArtworkSlot.tsx` | Right column; the 420×420 `PLACEHOLDER` box |
| `src/components/settings/fields/*.tsx` | One renderer per `FieldKind`, plus a `FieldRenderer` switch |
| `src/components/ui/switch.tsx`, `src/components/ui/select.tsx` | New shadcn primitives (see §7.4) |
| `src/data/settings.mock.ts` | Browser-dev fallback, analogous to `bluetooth.mock.ts` |

### 7.2 i18n

- Add a `settings` block to **both** `src/i18n/locales/en.ts` and `it.ts` (missing `it.ts` key is a type
  error — `AGENTS.md` §5.6). `en.ts` exports `Messages`; `it.ts` is typed against it.
- Category and field labels are **keys**, resolved with `t()`. The renderer must tolerate a missing key
  by falling back to the key's last segment rather than rendering `undefined` (tests cover this).
- Minimum keys: `settings.title`, `settings.category.<id>.label|title` ×5, one key per shipped field,
  `settings.placeholder` (value `PLACEHOLDER`), `settings.reset`, `settings.unavailable`.

### 7.3 The adaptive layout plan (the heart of I1)

`planCategories()` is a **pure function** and the only place layout decisions are made. Nothing in the
component tree may branch on a field kind, a category id, or an option count.

```ts
export interface PlannedField {
  field: FieldDef;
  value: FieldValue;
  label: string;                     // resolved from labelKey with fallback
  help?: string;
  options?: { value: string; label: string }[];  // select only, labels resolved
}

export interface PlannedGroup {
  id: string;
  label?: string;
  fields: PlannedField[];            // hidden fields excluded; empty groups dropped
}

export interface PlannedCategory {
  id: string;
  title: string;                     // resolved, but no longer printed as a heading
  groups: PlannedGroup[];
  empty: boolean;                    // true when no field is visible → render the empty state
}

/** Text-only rail entry: no icon, by design (§2, §4). */
export interface PlannedRailItem {
  id: string;
  label: string;
  active: boolean;
}

export function planCategories(
  categories: CategoryDef[],
  activeCategoryId: string | null,
  values: Record<string, SettingsValues>,
  t: (key: string) => string,
  titleKey?: string,                 // defaults to "settings.title"
): { title: string; rail: PlannedRailItem[]; active: PlannedCategory | null };
```

`planCategories` is the **only** place labels are resolved, including the section `title` and each
select option's label. The components therefore receive display strings and never touch an i18n key.

Rules the function must satisfy (each gets a test):

- Rail order is `CATEGORY_ORDER` order, filtered to registered categories; the active item is
  identifiable without string comparison in the component.
- Rail entries carry text only — no icon, no extra field. A test pins the exact key set of a rail item
  so an icon cannot creep back in unnoticed.
- The plan exposes a single `title` (the section header), resolved from `titleKey` with the same
  fallback as every other label.
- `visible` is `showWhen` resolved **only** against the same category's values (I3); a `showWhen` whose
  referenced field is absent is `false`, not a crash.
- Groups render in declaration order; fields render in declaration order; ungrouped fields land in one
  implicit group placed **last**.
- A category whose fields are all hidden yields `empty: true` and groups `[]` — the panel shows the
  empty state; it does not crash and does not render an empty divider.
- The function is referentially transparent: same inputs → deep-equal output, no mutation of inputs.
- **Adaptation proof:** given a synthetic category with N toggles, N sliders, a `select` and a hidden
  field, the plan contains exactly N visible toggles/sliders and no hidden entry — i.e. the UI follows
  the schema with zero code change.

### 7.4 Controls

- One small component per kind: `ToggleField`, `SliderField`, `SelectField`, `StepperField`. Each takes
  `PlannedField` + `onChange` and nothing else. `FieldRenderer` maps `kind → component`; an unknown kind
  renders a disabled "unsupported" row (defensive, and the reason a future kind cannot crash the view).
- `Switch`: build on an accessible element following the existing shadcn pattern (Radix is already a
  dependency; `@radix-ui/react-switch` may be added, or use the existing `button` + `role="switch"`
  approach — pick one and keep it consistent). Visuals: amber-500 track when on, warm-50 knob, focus
  ring per §4.
- `Select`: reuse `@radix-ui/react-select` if added; otherwise a horizontally scrollable segmented
  control built from `button`s. Either way it must be reachable and operable by rotary-only input.
- `Slider`: reuse `src/components/ui/slider.tsx`; show the numeric value in the monospaced treatment.
- `Stepper`: `-`/`+` buttons around the value; buttons disabled at `min`/`max`.
- **Read-only** fields render their value with no interactive control and are excluded from focus order.

### 7.5 Integration (chosen: home tile, no Navbar change)

- `NAV_ORDER` (`src/constants/navigation.ts`) and `Navbar.tsx` stay at three items. Do **not** add a
  fourth.
- Add `"settings"` to `NavId` in `src/types/navigation.ts`, and add `settings: SettingsView` to the
  `ActiveView`/render switch in `App.tsx`.
- Wire the **existing** `DEFAULT_APPS` settings entry (`src/data/apps.tsx`, currently inert) so its
  `onClick` selects the settings view. `AppsGrid` already calls `app.onClick?.()`; keep it generic and
  pass the handler down rather than hardcoding an id check inside `AppsGrid`.
- Wrap the tree in `SettingsProvider` in `src/main.tsx`, inside the existing provider stack and **after**
  `I18nProvider` (labels). The stack becomes
  `I18nProvider > BluetoothProvider > JukeboxProvider > CdProvider > SettingsProvider > App`.
- The view must mount without the service or an Electron preload present (plain `npm run dev` in a
  browser) by falling back to `src/data/settings.mock.ts` — same contract as the other three sources.
- Leaving the view must not lose unsaved changes: writes are per-interaction (`PATCH` on change,
  optimistic + rollback on failure), so there is no dirty state to lose.

---

## 8. Input model (rotary-first)

The car is driven by a rotary encoder + Enter. Per `AGENTS.md` §5.6, `useRotaryNavigation` is attached
**per view**; do not extend the global one.

- `SettingsView` attaches `useRotaryNavigation({ selector: "button, [role='switch'], [role='slider'], [data-settings-focusable]" })`.
- Focus order is DOM order: rail items first, then controls. The wheel while the **rail** has focus must
  move *between categories*; while a control has focus it moves between controls. Implement this as an
  explicit mode in `SettingsView` (e.g. rail focused ↔ panel focused, switched by Left/Right), and
  document the chosen mapping in a short comment. Do not silently change `useRotaryNavigation`'s
  existing behaviour for other views.
- Enter/Space activate the focused control; Left/Right adjust sliders and steppers; Escape returns focus
  to the rail.
- Keyboard and mouse/touch must reach every control too — rotary is the *primary*, not the only, input.
- Respect `prefers-reduced-motion` for any transition (the codebase already does this via
  `useReducedMotion`).

---

## 9. Tests (`frontend/test/*.test.ts`, native `node:test`)

No new dependency, no jsdom. Use `test/support.ts` helpers where they fit; add a `test/fake-settings-store-provider.ts`-style double if needed, and keep every double structural.

### 9.1 Backend — `test/settings-service.test.ts`

- Registry rejects: duplicate category id, duplicate field id, `showWhen` referencing another category
  (**I2**, the headline test), `default` out of range, `min > max`, `step <= 0`, empty `options`.
- `PATCH` validation matrix from §6.5: unknown category `404`; unknown field `400`; read-only `400`;
  wrong type `400`; out of range `400`; bad `select` value `400`; slider snapping; stepper off-lattice
  `400`; partial merge returns the full set; malformed JSON `400`; wrong method `405`; unknown route
  `404`.
- `POST /api/values/:id/reset` restores exactly the schema defaults.
- `GET /api/categories` needs no values and is complete enough to render (every field carries its
  constraints).
- Service starts on port `0` with `installProcessHandlers: false` and `logger: createSilentLogger()`.

### 9.2 Backend adaptivity — `test/settings-store.test.ts`

- A temp-dir store round-trips values.
- **I6:** with one category's blob corrupted, that category alone returns defaults while the others keep
  their values; a fully malformed file yields all-defaults rather than throwing.
- Values for removed fields are dropped on load and the drop is persisted on next write.
- Stored out-of-range/type-invalid values are re-normalised on load.
- **Adaptivity proof:** construct the service with a registry that includes a **sixth throwaway
  category** (§9.3) and assert `GET /api/categories`, `GET /api/values`, and a `PATCH` all handle it with
  **zero production code changes** — the store and routes are schema-driven.
- Atomic write: the store directory contains no `*.tmp` after a successful save.

### 9.3 The throwaway category

Define it **inside the test file** (or a `test/settings-fixture.ts` helper): id `test-fixture`, with a
toggle, a slider, a select, a stepper, a read-only field, and a field gated by `showWhen` on its own
toggle. It is the shared fixture for §9.1–§9.4. It must not be imported by any production module.

### 9.4 Frontend — `test/settings-layout.test.ts`

Pure-function tests only, covering every rule in §7.3 — including the adaptation proof (synthetic schema
→ expected plan) and an i18n-missing-key fallback test.

---

## 10. Execution checklist

1. `settings-service/` skeleton + `config.ts` + `types.ts` + `fields.ts` + `registry.ts` + `store.ts`.
2. The five category modules in `CATEGORY_ORDER` order, with the minimal demo fields of §6.4.
3. `SettingsService` extending `BaseMediaService` with the §6.3 routes.
4. `index.ts` entry; register the Vite electron entry and the spawn/stop in `electron/main.ts`;
   add the `settings:get-endpoint` IPC handler + `preload.ts` global (`window.settings`).
5. Backend tests (§9.1, §9.2). Get them green before touching the renderer.
6. `src/types/settings.ts`, `src/services/settings.ts`, `src/lib/settings-layout.ts` + tests (§9.4).
7. `useSettings` + provider/context; `src/data/settings.mock.ts`.
8. `SettingsView` + rail + panel + artwork slot + field components; new `ui/switch.tsx` / `ui/select.tsx`.
9. i18n keys in `en.ts` **and** `it.ts`.
10. Wire the home tile and `App.tsx` view switch (§7.5).
11. `npm test && npm run lint && npm run build`.
12. Update `AGENTS.md` in the same change: add the service row to §5.3, the endpoints to the service
    table, `SETTINGS_PORT`/`SETTINGS_STORE_PATH` to §6, the new files to §2, and the view to §5.4.

## 11. Explicitly forbidden

- Any placeholder *image* for the right panel: text `PLACEHOLDER` in a 420×420 box only.
- `modus_wireframe.png` (or any generated art) as the right-panel asset.
- Hardcoding category ids, field ids, labels or control kinds in `src/components/**` (I1).
- Any dependency between settings of different categories (I2), including shared validation that reads
  another category's values.
- Touching system/master volume or repurposing `EntertainmentVolumeController` (I5).
- Inventing real vehicle features, actuator wiring, or "smart" behaviour not asked for.
- A fourth `Navbar` item or a change to `NAV_ORDER`.
- New runtime dependencies beyond the existing Radix/shadcn stack; jsdom or testing-library.
- Editing the generated `backend/` C files (unrelated, but the rule stands).
