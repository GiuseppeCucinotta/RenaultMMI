/**
 * Tiny tagged logger shared by every host service.
 *
 * Replaces the three near-identical per-service `logger.ts` copies. The object
 * is deliberately a plain frozen singleton: no timers, no buffers, no state —
 * logging must never be the reason a service holds memory.
 */
export interface Logger {
  log(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

function stamp(): string {
  return new Date().toISOString();
}

export function createLogger(scope: string): Logger {
  return {
    log(...args: unknown[]): void {
      console.log(`[${scope}] ${stamp()}`, ...args);
    },
    info(...args: unknown[]): void {
      console.info(`[${scope}] ${stamp()}`, ...args);
    },
    warn(...args: unknown[]): void {
      console.warn(`[${scope}] ${stamp()} WARN`, ...args);
    },
    error(...args: unknown[]): void {
      console.error(`[${scope}] ${stamp()} ERROR`, ...args);
    },
  };
}

/** No-op logger for tests: keeps runner output readable. */
export function createSilentLogger(): Logger {
  const noop = (): void => undefined;
  return { log: noop, info: noop, warn: noop, error: noop };
}

/** Normalises an unknown thrown value into a loggable string. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
