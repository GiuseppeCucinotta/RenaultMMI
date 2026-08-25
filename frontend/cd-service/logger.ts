function stamp(): string {
  return new Date().toISOString();
}

export const logger = {
  log(...args: unknown[]): void {
    console.log(`[cd] ${stamp()}`, ...args);
  },
  info(...args: unknown[]): void {
    console.info(`[cd] ${stamp()}`, ...args);
  },
  warn(...args: unknown[]): void {
    console.warn(`[cd] ${stamp()} WARN`, ...args);
  },
  error(...args: unknown[]): void {
    console.error(`[cd] ${stamp()} ERROR`, ...args);
  },
};
