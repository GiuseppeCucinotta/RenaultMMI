function stamp(): string {
  return new Date().toISOString();
}

export const logger = {
  log(...args: unknown[]): void {
    console.log(`[bluetooth] ${stamp()}`, ...args);
  },
  info(...args: unknown[]): void {
    console.info(`[bluetooth] ${stamp()}`, ...args);
  },
  warn(...args: unknown[]): void {
    console.warn(`[bluetooth] ${stamp()} WARN`, ...args);
  },
  error(...args: unknown[]): void {
    console.error(`[bluetooth] ${stamp()} ERROR`, ...args);
  },
};
