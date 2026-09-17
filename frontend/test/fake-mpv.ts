import { EventEmitter } from "node:events";
import type {
  MpvEventListener,
  MpvFactory,
  MpvLike,
  MpvOptions,
} from "../shared/mpv.js";

export interface MpvCall {
  method: string;
  args: unknown[];
}

/**
 * Test double for {@link MpvLike}.
 *
 * The host services take an `MpvFactory`, so no module mocking is needed here:
 * the test injects this instance and gets a complete, inspectable transcript of
 * every command the service sent to "mpv".
 */
export class FakeMpv implements MpvLike {
  /**
   * Composition, not inheritance: `EventEmitter.on` is generic over
   * `(...args: any[])`, which is not assignable to the narrow listener
   * contract the services depend on.
   */
  private readonly emitter = new EventEmitter();
  readonly calls: MpvCall[] = [];
  /** Values returned by `getProperty`, written by `setProperty`/`jump`. */
  readonly properties = new Map<string, unknown>();
  duration = 0;
  running = false;
  /** Pause state, mirrored from the real mpv's observed `pause` property. */
  paused = false;
  readonly options: MpvOptions;
  readonly args: string[];

  constructor(options: MpvOptions, args: string[]) {
    this.options = options;
    this.args = args;
    if (args.includes("--pause=yes")) {
      this.paused = true;
      this.properties.set("pause", true);
    }
  }

  /** Register a listener; the services only ever call this. */
  on(event: string, listener: MpvEventListener): this {
    this.emitter.on(event, listener as (...args: unknown[]) => void);
    return this;
  }

  /** Drives the fake exactly like the real mpv would (tests only). */
  emit(event: string, ...args: unknown[]): boolean {
    return this.emitter.emit(event, ...args);
  }

  /** All calls to `method`, in order. */
  callsTo(method: string): MpvCall[] {
    return this.calls.filter((call) => call.method === method);
  }

  lastCall(method: string): MpvCall | undefined {
    const calls = this.callsTo(method);
    return calls.length > 0 ? calls[calls.length - 1] : undefined;
  }

  /* ------------------------------- lifecycle ------------------------------ */

  async start(): Promise<void> {
    this.running = true;
    this.record("start");
  }

  async quit(): Promise<void> {
    this.running = false;
    this.record("quit");
  }

  isRunning(): boolean {
    return this.running;
  }

  /* ------------------------------- playback ------------------------------- */

  async load(source: string, mode?: string): Promise<void> {
    this.record("load", source, mode);
  }

  async append(source: string, mode?: string): Promise<void> {
    this.record("append", source, mode);
  }

  async clearPlaylist(): Promise<void> {
    this.record("clearPlaylist");
  }

  async loopPlaylist(times?: number | string): Promise<void> {
    this.record("loopPlaylist", times);
  }

  // Playback commands mirror mpv's own event feedback: a real mpv emits
  // `paused`/`resumed`/`stopped`, and the players rely on those to update
  // their state. The fake does the same so tests observe realistic behaviour.
  async play(): Promise<void> {
    this.record("play");
    this.setPaused(false);
    this.emit("resumed");
  }

  async pause(): Promise<void> {
    this.record("pause");
    this.setPaused(true);
    this.emit("paused");
  }

  async resume(): Promise<void> {
    this.record("resume");
    this.setPaused(false);
    this.emit("resumed");
  }

  async togglePause(): Promise<void> {
    this.record("togglePause");
    this.setPaused(!this.paused);
    this.emit(this.paused ? "paused" : "resumed");
  }

  async stop(): Promise<void> {
    this.record("stop");
    this.setPaused(false);
    this.emit("stopped");
  }

  /** Keeps the `pause` property in sync, exactly like real mpv exposes it. */
  private setPaused(paused: boolean): void {
    this.paused = paused;
    this.properties.set("pause", paused);
  }

  async next(): Promise<void> {
    this.record("next");
  }

  async prev(): Promise<void> {
    this.record("prev");
  }

  async jump(position: number): Promise<void> {
    this.properties.set("playlist-pos", position);
    this.record("jump", position);
  }

  async seek(seconds: number, mode?: string): Promise<void> {
    this.record("seek", seconds, mode);
  }

  async volume(volume: number): Promise<void> {
    this.record("volume", volume);
  }

  /* ------------------------------ properties ------------------------------ */

  async getDuration(): Promise<number> {
    return this.duration;
  }

  async getProperty(property: string): Promise<unknown> {
    return this.properties.get(property);
  }

  async getMetadata(): Promise<object> {
    return {};
  }

  async setProperty(property: string, value: unknown): Promise<void> {
    this.properties.set(property, value);
    this.record("setProperty", property, value);
  }

  async command(command: string, args: string[]): Promise<void> {
    // Mirrors how the CD player loads protocol URLs (cdda://) without going
    // through node-mpv's path resolution.
    if (command === "loadfile") this.properties.set("playlist-pos", 0);
    this.record("command", command, args);
  }

  private record(method: string, ...args: unknown[]): void {
    this.calls.push({ method, args });
  }
}

export interface FakeMpvFactory {
  /** Every instance the factory produced, in creation order. */
  readonly instances: FakeMpv[];
  readonly createMpv: MpvFactory;
}

export function createFakeMpvFactory(): FakeMpvFactory {
  const instances: FakeMpv[] = [];
  return {
    instances,
    createMpv: (options, args) => {
      const mpv = new FakeMpv(options, args);
      instances.push(mpv);
      return mpv;
    },
  };
}
