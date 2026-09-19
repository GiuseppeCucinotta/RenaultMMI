/**
 * Shared test plumbing for the settings suites: a `PATCH` fetch helper (the
 * generic `test/support.ts` only ships GET/POST), the production category
 * definitions, and a start/stop wrapper that never leaks a bound port.
 */

import { createSilentLogger, type Logger } from "../shared/logger.js";
import { audioCategory } from "../settings-service/categories/audio.js";
import { connectivityCategory } from "../settings-service/categories/connectivity.js";
import { displayCategory } from "../settings-service/categories/display.js";
import { systemCategory } from "../settings-service/categories/system.js";
import { vehicleCategory } from "../settings-service/categories/vehicle.js";
import { createRegistry, type SettingsRegistry } from "../settings-service/registry.js";
import { SettingsService, type SettingsServiceOptions } from "../settings-service/service.js";
import type { CategoryDef } from "../settings-service/types.js";
import { FIXTURE_ALLOWED_IDS, testFixtureCategory } from "./settings-fixture.js";
import type { ApiResult } from "./support.js";

/** The five shipped categories, in `CATEGORY_ORDER`. */
export const PRODUCTION_CATEGORIES: CategoryDef[] = [
  vehicleCategory,
  audioCategory,
  connectivityCategory,
  displayCategory,
  systemCategory,
];

export const PRODUCTION_CATEGORY_IDS = PRODUCTION_CATEGORIES.map((category) => category.id);

/** The production registry plus the throwaway sixth test category. */
export const FIXTURE_REGISTRY: SettingsRegistry = createRegistry(
  [...PRODUCTION_CATEGORIES, testFixtureCategory],
  FIXTURE_ALLOWED_IDS,
);

export async function apiPatch<T>(url: string, payload: unknown): Promise<ApiResult<T>> {
  const response = await fetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return { status: response.status, body: (await response.json()) as T };
}

export async function apiPostRaw<T>(url: string, raw: string): Promise<ApiResult<T>> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: raw,
  });
  return { status: response.status, body: (await response.json()) as T };
}

export function uniqueStorePath(label: string): string {
  return `/tmp/renault-mmi-settings-${process.pid}-${label}-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2)}.json`;
}

export interface SettingsServiceContext {
  service: SettingsService;
  base: string;
  logger: Logger;
}

export interface SettingsServiceHarnessOptions extends SettingsServiceOptions {
  /** Temp store path; ignored when `store` is injected. */
  storePath?: string;
}

/** Starts a service on an ephemeral port and always stops it afterwards. */
export async function withSettingsService(
  options: SettingsServiceHarnessOptions,
  run: (ctx: SettingsServiceContext) => Promise<void>,
): Promise<void> {
  const logger = options.logger ?? createSilentLogger();
  const service = new SettingsService(
    { port: 0, storePath: options.storePath ?? uniqueStorePath("service") },
    {
      ...options,
      logger,
      settings: { autoSuspend: false, ...options.settings },
      installProcessHandlers: false,
    },
  );

  await service.start();
  try {
    await run({ service, base: `http://127.0.0.1:${service.port}`, logger });
  } finally {
    await service.stop();
  }
}

/** Starts a service with the fixture registry (production + `test-fixture`). */
export async function withFixtureService(
  run: (ctx: SettingsServiceContext) => Promise<void>,
  overrides: Partial<SettingsServiceOptions> = {},
): Promise<void> {
  await withSettingsService(
    { registry: FIXTURE_REGISTRY, ...overrides },
    run,
  );
}
