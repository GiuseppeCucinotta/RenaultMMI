/**
 * The Settings service: a schema + values store behind a small HTTP surface.
 *
 * It owns no hardware and holds no audio, so it is always safe to suspend and
 * it never reports `isBusy() === true`. HTTP, SSE, routing, shutdown and the
 * running ⇄ suspended state machine come from {@link BaseMediaService}; the
 * built-in `/api/settings` (process lifecycle) routes stay untouched.
 *
 * Note the route namespace: user-facing settings live under `/api/categories`
 * and `/api/values/...`, never under `/api/settings`.
 */

import { errorMessage, type Logger } from "../shared/logger.js";
import {
  BaseMediaService,
  HttpError,
  requireMethod,
  sendJson,
  type RouteContext,
  type RouteTable,
  type ServiceSettings,
} from "../shared/service-http.js";
import { audioCategory } from "./categories/audio.js";
import { connectivityCategory } from "./categories/connectivity.js";
import { displayCategory } from "./categories/display.js";
import { systemCategory } from "./categories/system.js";
import { vehicleCategory } from "./categories/vehicle.js";
import type { SettingsConfig } from "./config.js";
import { fieldDefaults, normalizeFieldValue } from "./fields.js";
import { createRegistry, type SettingsRegistry } from "./registry.js";
import { SettingsStore } from "./store.js";
import type { CategoryDef, SettingsState, SettingsValues } from "./types.js";

export interface SettingsServiceOptions {
  logger?: Logger;
  /** Tests inject a registry that also carries their fixture category. */
  registry?: SettingsRegistry;
  /** Tests inject a store pointed at a temp path. */
  store?: SettingsStore;
  settings?: Partial<ServiceSettings>;
  installProcessHandlers?: boolean;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export class SettingsService extends BaseMediaService<SettingsState> {
  private readonly registry: SettingsRegistry;
  private readonly store: SettingsStore;
  /**
   * The schema array, cached so `/api/state` (and therefore every SSE frame)
   * does not have to deep-clone a constant. Values are always copied.
   */
  private readonly schema: CategoryDef[];
  /** Live values in RAM; field access is only ever through a copy. */
  private values: Record<string, SettingsValues> = {};

  constructor(config: SettingsConfig, options: SettingsServiceOptions = {}) {
    const logger = options.logger;
    super({
      name: "settings",
      port: config.port,
      logger,
      settings: options.settings,
      installProcessHandlers: options.installProcessHandlers,
    });

    // Production passes nothing, so the five fixed categories are the complete
    // allowed set; a test registry built with an explicit allowed-ids override
    // (its fixture category) just works here, unchanged.
    this.registry =
      options.registry ??
      createRegistry([
        vehicleCategory,
        audioCategory,
        connectivityCategory,
        displayCategory,
        systemCategory,
      ]);
    this.store =
      options.store ??
      new SettingsStore({
        path: config.storePath,
        logger: this.logger,
        registry: this.registry,
      });
    this.schema = [...this.registry.categories];
  }

  /* ------------------------------- base hooks ----------------------------- */

  protected async onStart(): Promise<void> {
    this.values = await this.store.load();
    this.logger.log(
      `${this.registry.categories.length} categories, ${Object.values(this.values).reduce(
        (total, category) => total + Object.keys(category).length,
        0,
      )} settings loaded`,
    );
  }

  /** A pending write must not be lost on shutdown. */
  protected async onStop(): Promise<void> {
    await this.store.flush();
  }

  protected getState(): SettingsState {
    return { categories: this.schema, values: this.copyValues() };
  }

  /* -------------------------------- handlers ------------------------------ */

  protected createRoutes(): RouteTable {
    return {
      categories: (ctx) => this.handleCategories(ctx),
      values: (ctx) => this.handleValues(ctx),
    };
  }

  /** `GET /api/categories` — the render model, no values (I1). */
  private handleCategories(ctx: RouteContext): void {
    requireMethod(ctx, "GET");
    sendJson(ctx.res, 200, { categories: this.schema });
  }

  /**
   * `GET /api/values` and `GET|PATCH /api/values/:categoryId`, plus
   * `POST /api/values/:categoryId/reset`. Dispatching on `parts` mirrors how
   * `cd-service`/`jukebox-service` read their path segments.
   */
  private async handleValues(ctx: RouteContext): Promise<void> {
    const categoryId = ctx.parts[2];

    if (!categoryId) {
      requireMethod(ctx, "GET");
      sendJson(ctx.res, 200, { values: this.copyValues() });
      return;
    }

    if (ctx.parts[3] === "reset") {
      await this.handleReset(ctx, categoryId);
      return;
    }

    if (ctx.parts.length > 3) throw new HttpError(404, "Not found");

    if (ctx.method === "PATCH") {
      await this.handlePatch(ctx, categoryId);
      return;
    }
    requireMethod(ctx, "GET");
    sendJson(ctx.res, 200, { categoryId, values: this.categoryValues(categoryId) });
  }

  private async handlePatch(ctx: RouteContext, categoryId: string): Promise<void> {
    const category = this.categoryOrThrow(categoryId);

    const body = await ctx.body();
    const patch = body.values;
    if (!isPlainObject(patch)) {
      throw new HttpError(400, "values must be an object");
    }

    const snapshot = this.store.snapshot();
    const merged: SettingsValues = { ...(this.values[categoryId] ?? {}) };
    for (const [fieldId, raw] of Object.entries(patch)) {
      const field = category.fields.find((candidate) => candidate.id === fieldId);
      if (!field) throw new HttpError(400, `unknown setting "${fieldId}"`);
      if (field.readOnly) throw new HttpError(400, `setting "${fieldId}" is read-only`);
      try {
        merged[fieldId] = normalizeFieldValue(field, raw);
      } catch (error) {
        // A hidden (showWhen false) field is still writable: visibility is a
        // rendering concern and never a validation rule.
        throw new HttpError(400, `invalid value for setting "${fieldId}": ${errorMessage(error)}`);
      }
    }

    // Re-normalise the whole merged set: omitted fields keep their stored
    // values, and anything the schema no longer knows about cannot survive.
    const next = this.normalizeAll(category, merged);
    this.values[categoryId] = next;
    this.store.setCategory(categoryId, next);

    try {
      // Persist before answering: a failed save must change nothing.
      await this.store.flush();
    } catch (error) {
      this.values = snapshot;
      this.broadcast();
      throw new HttpError(500, `could not save settings: ${errorMessage(error)}`);
    }

    this.broadcast();
    sendJson(ctx.res, 200, { categoryId, values: { ...next } });
  }

  private async handleReset(ctx: RouteContext, categoryId: string): Promise<void> {
    requireMethod(ctx, "POST");
    const category = this.categoryOrThrow(categoryId);

    const snapshot = this.store.snapshot();
    const defaults = fieldDefaults(category);
    this.values[categoryId] = defaults;
    this.store.setCategory(categoryId, defaults);

    try {
      await this.store.flush();
    } catch (error) {
      this.values = snapshot;
      this.broadcast();
      throw new HttpError(500, `could not save settings: ${errorMessage(error)}`);
    }

    this.broadcast();
    sendJson(ctx.res, 200, { categoryId, values: { ...defaults } });
  }

  /* -------------------------------- helpers ------------------------------- */

  private categoryOrThrow(categoryId: string): CategoryDef {
    const category = this.registry.byId.get(categoryId);
    if (!category) throw new HttpError(404, `unknown settings category "${categoryId}"`);
    return category;
  }

  private categoryValues(categoryId: string): SettingsValues {
    const category = this.categoryOrThrow(categoryId);
    return { ...(this.values[categoryId] ?? fieldDefaults(category)) };
  }

  private normalizeAll(category: CategoryDef, values: SettingsValues): SettingsValues {
    const normalized: SettingsValues = {};
    for (const field of category.fields) {
      const current = field.id in values ? values[field.id] : field.default;
      try {
        normalized[field.id] = normalizeFieldValue(field, current);
      } catch {
        normalized[field.id] = normalizeFieldValue(field, field.default);
      }
    }
    return normalized;
  }

  private copyValues(): Record<string, SettingsValues> {
    const copy: Record<string, SettingsValues> = {};
    for (const [categoryId, values] of Object.entries(this.values)) {
      copy[categoryId] = { ...values };
    }
    return copy;
  }
}
