import fs from "node:fs";

export interface WatchHandle {
  close(): void;
}

/** Injectable so the debounce/coalescing logic can be tested without inotify. */
export type WatchFn = (path: string, listener: (filename: string) => void) => WatchHandle;

export interface DevWatchTarget {
  /** Label used in logs and to key the debounce timer. */
  name: string;
  /** File or directory to watch. */
  path: string;
  /** Called once per burst of changes (debounced). */
  onChange: () => void;
  /** Only react to matching file names; defaults to every event. */
  match?: (filename: string) => boolean;
}

export interface DevWatchOptions {
  debounceMs?: number;
  watch?: WatchFn;
  onError?: (name: string, error: unknown) => void;
}

/** A rollup build touches its outputs several times; coalesce those bursts. */
const DEFAULT_DEBOUNCE_MS = 300;

const defaultWatch: WatchFn = (path, listener) => {
  const watcher = fs.watch(path, { persistent: false }, (_event, filename) => {
    listener(filename == null ? "" : String(filename));
  });
  return { close: () => watcher.close() };
};

/**
 * Dev-only: react to freshly built bundles.
 *
 * `vite-plugin-electron` rebuilds `dist-electron/**` on every source edit, but
 * its `reload()` only refreshes the renderer. The Electron main process and the
 * service child processes it spawned keep running the previous code, so a
 * service edit used to require restarting the whole app — and a stale main
 * process could keep an old behaviour alive for the lifetime of the session.
 *
 * Watching the build outputs closes that loop: each service bundle restarts its
 * own child process, and a rebuilt `main.js` relaunches the app.
 *
 * @returns a disposer that stops watching and cancels pending restarts.
 */
export function watchDevArtifacts(
  targets: readonly DevWatchTarget[],
  options: DevWatchOptions = {},
): () => void {
  const watch = options.watch ?? defaultWatch;
  const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  const timers = new Map<string, NodeJS.Timeout>();
  const handles: WatchHandle[] = [];

  for (const target of targets) {
    const listener = (filename: string): void => {
      if (target.match && !target.match(filename)) return;

      const pending = timers.get(target.name);
      if (pending) clearTimeout(pending);
      const timer = setTimeout(() => {
        timers.delete(target.name);
        target.onChange();
      }, debounceMs);
      timer.unref();
      timers.set(target.name, timer);
    };

    try {
      handles.push(watch(target.path, listener));
    } catch (error) {
      // A missing build directory must not take the dev session down.
      options.onError?.(target.name, error);
    }
  }

  return () => {
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
    for (const handle of handles) handle.close();
    handles.length = 0;
  };
}
