/**
 * Settings persistence.
 *
 * The store is deliberately independent of the HTTP service: it takes an
 * injected path + logger + registry, so tests construct it directly. It owns
 * three guarantees:
 *
 * - **I6 — per-category isolation.** Each category blob is parsed and
 *   normalised inside its own `try/catch`; a corrupt blob resets that category
 *   alone. A corrupt *file* resets everything, never throws.
 * - **Schema is authoritative.** Stored values are re-normalised on load —
 *   invalid ones fall back to their default, fields that no longer exist are
 *   dropped — so an edited schema can never produce an invalid live value.
 * - **Atomic, serialised writes.** `write tmp` → `rename`, one write at a time,
 *   so a crash cannot leave a truncated file and concurrent `setCategory`
 *   calls cannot interleave.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { errorMessage, type Logger } from "../shared/logger.js";
import { normalizeFieldValue } from "./fields.js";
import { defaultValues, type SettingsRegistry } from "./registry.js";
import type { CategoryDef, FieldDef, SettingsCategoryId, SettingsValues } from "./types.js";

/** Bump when the on-disk shape changes in a way that needs migration. */
const STORE_VERSION = 1;

export interface SettingsStoreOptions {
  path: string;
  logger: Logger;
  registry: SettingsRegistry;
}

interface StoredFile {
  version: number;
  categories: Record<string, Record<string, unknown>>;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export class SettingsStore {
  private readonly filePath: string;
  private readonly logger: Logger;
  private readonly registry: SettingsRegistry;
  private readonly fieldById = new Map<string, Map<string, FieldDef>>();

  private current: Record<SettingsCategoryId, SettingsValues>;
  private writeSequence = 0;
  private lastWrite: Promise<void> | null = null;
  private pendingError: unknown = null;

  constructor(options: SettingsStoreOptions) {
    this.filePath = options.path;
    this.logger = options.logger;
    this.registry = options.registry;
    this.current = defaultValues(this.registry);

    for (const category of this.registry.categories) {
      const fields = new Map<string, FieldDef>();
      for (const field of category.fields) fields.set(field.id, field);
      this.fieldById.set(category.id, fields);
    }
  }

  /** Schema defaults, or the normalised contents of the file. Never throws. */
  async load(): Promise<Record<SettingsCategoryId, SettingsValues>> {
    let categories: Record<string, unknown> | null = null;

    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      const parsed: unknown = JSON.parse(raw);
      if (isPlainObject(parsed) && isPlainObject(parsed.categories)) {
        categories = parsed.categories;
      } else {
        this.logger.warn(`settings file ${this.filePath} has an unexpected shape — using defaults`);
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        this.logger.log("no settings file yet — starting from defaults");
      } else {
        this.logger.warn(
          `could not read settings file ${this.filePath} (${errorMessage(error)}) — using defaults`,
        );
      }
    }

    const loaded: Record<SettingsCategoryId, SettingsValues> = {};
    for (const category of this.registry.categories) {
      const blob = categories ? categories[category.id] : undefined;
      if (blob === undefined) {
        loaded[category.id] = this.normalizeCategory(category, {}, false);
        continue;
      }
      try {
        if (!isPlainObject(blob)) {
          throw new Error("stored value is not an object");
        }
        loaded[category.id] = this.normalizeCategory(category, blob, true);
      } catch (error) {
        // I6: only this category falls back, the others keep their values.
        this.logger.warn(
          `settings category "${category.id}" is unreadable (${errorMessage(error)}) — using defaults`,
        );
        loaded[category.id] = this.normalizeCategory(category, {}, false);
      }
    }

    this.current = loaded;
    return this.snapshot();
  }

  /** In-memory update; never throws — a failed save surfaces on `flush()`. */
  setCategory(categoryId: string, values: SettingsValues): void {
    this.current = { ...this.current, [categoryId]: { ...values } };
    void this.scheduleWrite();
  }

  /** Awaits the pending write; rejects with the error of a failed save. */
  flush(): Promise<void> {
    const pending = this.lastWrite ?? Promise.resolve();
    return pending.then(() => {
      if (this.pendingError !== null) {
        const error = this.pendingError;
        this.pendingError = null;
        throw error instanceof Error ? error : new Error(String(error));
      }
    });
  }

  snapshot(): Record<SettingsCategoryId, SettingsValues> {
    const copy: Record<SettingsCategoryId, SettingsValues> = {};
    for (const [categoryId, values] of Object.entries(this.current)) {
      copy[categoryId] = { ...values };
    }
    return copy;
  }

  /* ------------------------------- internals ------------------------------ */

  /**
   * Normalises one category blob against the current schema: unknown field ids
   * are dropped, stored values are re-validated (each failure falls back to the
   * field default), and missing fields are filled from the schema.
   */
  private normalizeCategory(
    category: CategoryDef,
    blob: Record<string, unknown>,
    reportInvalid: boolean,
  ): SettingsValues {
    const fields = this.fieldById.get(category.id) ?? new Map();
    const values: SettingsValues = {};

    for (const field of category.fields) {
      if (!(field.id in blob)) {
        values[field.id] = normalizeFieldValue(field, field.default);
        continue;
      }
      try {
        values[field.id] = normalizeFieldValue(field, blob[field.id]);
      } catch (error) {
        if (reportInvalid) {
          this.logger.warn(
            `settings ${category.id}.${field.id} is invalid (${errorMessage(error)}) — using its default`,
          );
        }
        values[field.id] = normalizeFieldValue(field, field.default);
      }
    }

    for (const key of Object.keys(blob)) {
      if (!fields.has(key)) {
        this.logger.warn(`dropping removed settings field ${category.id}.${key}`);
      }
    }

    return values;
  }

  /**
   * Appends one write to the serialisation chain. The snapshot is captured now
   * so a burst of `setCategory` calls ends with the latest state on disk, and
   * the chain stays usable after a failure.
   */
  private scheduleWrite(): Promise<void> {
    const sequence = (this.writeSequence += 1);
    const snapshot = this.snapshot();
    const write = this.writeChain().then(() => this.persist(sequence, snapshot));
    this.lastWrite = write;
    return write;
  }

  private writeChain(): Promise<void> {
    const previous = this.lastWrite;
    if (!previous) return Promise.resolve();
    // Swallow the predecessor's failure: this write is independent of it.
    return previous.then(
      () => undefined,
      () => undefined,
    );
  }

  private async persist(
    sequence: number,
    categories: Record<SettingsCategoryId, SettingsValues>,
  ): Promise<void> {
    try {
      await this.writeAtomic(sequence, categories);
      this.pendingError = null;
    } catch (error) {
      this.pendingError ??= error;
      this.logger.error(`saving settings to ${this.filePath} failed:`, errorMessage(error));
    }
  }

  private async writeAtomic(
    sequence: number,
    categories: Record<SettingsCategoryId, SettingsValues>,
  ): Promise<void> {
    const directory = path.dirname(this.filePath);
    const payload: StoredFile = { version: STORE_VERSION, categories };
    const tmpPath = path.join(
      directory,
      `.${path.basename(this.filePath)}.${process.pid}.${sequence}.tmp`,
    );

    await fs.mkdir(directory, { recursive: true });
    try {
      await fs.writeFile(tmpPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
      await fs.rename(tmpPath, this.filePath);
    } catch (error) {
      await fs.rm(tmpPath, { force: true }).catch(() => undefined);
      throw error;
    }
  }
}
