import os from "node:os";
import path from "node:path";
import Mpv from "node-mpv";

/**
 * The exact slice of `node-mpv` the host services use.
 *
 * Depending on this narrow contract (instead of the concrete class) is what
 * makes the players testable: `node:test` can inject a fake player through
 * {@link MpvFactory} without touching the module cache, and production code
 * still gets a freshly spawned mpv process.
 *
 * The listener parameter is typed `(...args: never[]) => void` so any concrete
 * callback (`(seconds: number) => void`, `(status: StatusObject) => void`, ...)
 * is accepted without falling back to `any`.
 */
export type MpvEventListener = (...args: never[]) => void;

export interface MpvLike {
  on(event: string, listener: MpvEventListener): unknown;
  start(): Promise<void>;
  quit(): Promise<void>;
  isRunning(): boolean;
  getDuration(): Promise<number>;
  getProperty(property: string): Promise<unknown>;
  getMetadata(): Promise<object>;
  setProperty(property: string, value: unknown): Promise<void>;
  command(command: string, args: string[]): Promise<void>;
  load(source: string, mode?: string): Promise<void>;
  append(source: string, mode?: string): Promise<void>;
  clearPlaylist(): Promise<void>;
  loopPlaylist(times?: number | string): Promise<void>;
  play(): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  togglePause(): Promise<void>;
  stop(): Promise<void>;
  next(): Promise<void>;
  prev(): Promise<void>;
  jump(position: number): Promise<void>;
  seek(seconds: number, mode?: string): Promise<void>;
  volume(volume: number): Promise<void>;
}

/** Subset of `node-mpv`'s (non-exported) options we set. */
export interface MpvOptions {
  binary: string;
  audio_only?: boolean;
  time_update?: number;
  socket: string;
  debug?: boolean;
  verbose?: boolean;
  auto_restart?: boolean;
}

export type MpvFactory = (options: MpvOptions, args: string[]) => MpvLike;

export const defaultMpvFactory: MpvFactory = (options, args) => new Mpv(options, args);

/**
 * Unique IPC socket per service instance. Keyed by pid so a dev-time service
 * (`npm run cd:debug`) and the Electron-spawned one never collide.
 */
export function mpvSocketPath(scope: string): string {
  return path.join(os.tmpdir(), `${scope}-mpv-${process.pid}.sock`);
}
