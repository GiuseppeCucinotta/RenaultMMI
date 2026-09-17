import { EventEmitter } from "node:events";
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createLogger, errorMessage, type Logger } from "../shared/logger.js";

export interface DriveSnapshot {
  device: string | null;
  hasMedia: boolean;
}

/** udev emits bursts (KERNEL + UDEV lines) — coalesce them into one probe. */
const EVENT_DEBOUNCE_MS = 250;
/** Slow safety net, used ONLY when `udevadm monitor` is unavailable. */
const FALLBACK_POLL_MS = 30_000;
/** Delay before re-spawning a monitor that exited unexpectedly. */
const MONITOR_RESTART_MS = 5_000;
const SPAWN_TIMEOUT_MS = 5_000;
const UDEVADM = "udevadm";

/**
 * Watches Linux optical drives (USB CD/DVD units show up as /dev/srN).
 *
 * Primary signal is `udevadm monitor --subsystem-match=block --udev`: the
 * kernel already notifies userspace on media insertion/removal, so there is no
 * reason to poll. stdout is parsed line by line and coalesced, then the drive
 * state is re-read from the dependency-free sources:
 * - drives are enumerated from /proc/sys/dev/cdrom/info + /sys/block/srN
 * - media presence comes from the udev database, falling back to
 *   /sys/block/srN/size (0 = no disc / tray open)
 *
 * When udevadm is missing (containers, stripped images) the monitor degrades to
 * a 30s poll instead of going blind.
 */
export class DriveMonitor extends EventEmitter {
  private readonly logger: Logger;
  private readonly preferredDevice: string | null;

  private monitor: ChildProcessWithoutNullStreams | null = null;
  private debounceTimer: NodeJS.Timeout | null = null;
  private fallbackTimer: NodeJS.Timeout | null = null;
  private restartTimer: NodeJS.Timeout | null = null;

  private snapshot: DriveSnapshot = { device: null, hasMedia: false };
  private running = false;
  private fallbackActive = false;

  constructor(preferredDevice?: string | null, logger: Logger = createLogger("cd")) {
    super();
    this.preferredDevice = preferredDevice ?? null;
    this.logger = logger;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.poll(); // initial state, before any event arrives
    this.startUdevMonitor();
  }

  stop(): void {
    this.running = false;
    this.stopUdevMonitor();
    this.clearTimer("debounceTimer");
    this.clearTimer("fallbackTimer");
    this.clearTimer("restartTimer");
  }

  getSnapshot(): DriveSnapshot {
    return this.snapshot;
  }

  /* ---------------------------- udev monitoring --------------------------- */

  private startUdevMonitor(): void {
    if (!this.running || this.monitor) return;

    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(UDEVADM, ["monitor", "--subsystem-match=block", "--udev"]);
    } catch (error) {
      this.enableFallback(errorMessage(error));
      return;
    }
    this.monitor = child;
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");

    // Line-oriented parse: keep the trailing partial line between chunks so a
    // split event is never dropped.
    let buffer = "";
    child.stdout.on("data", (chunk: string) => {
      buffer += chunk;
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) this.onUdevLine(line);
    });
    child.stderr.on("data", (chunk: string) => {
      const text = chunk.trim();
      if (text) this.logger.warn(`udevadm: ${text}`);
    });

    child.on("error", (error) => {
      if (this.monitor === child) this.monitor = null;
      if (!this.running) return;
      this.logger.warn(`udevadm monitor unavailable (${errorMessage(error)})`);
      this.enableFallback();
    });
    child.on("exit", (code) => {
      if (this.monitor !== child) return;
      this.monitor = null;
      if (!this.running) return;
      this.logger.warn(`udevadm monitor exited (code ${code ?? "null"}) — restarting`);
      this.scheduleRestart();
    });
  }

  private stopUdevMonitor(): void {
    const child = this.monitor;
    this.monitor = null;
    if (!child) return;
    child.removeAllListeners();
    child.stdout.removeAllListeners();
    child.stderr.removeAllListeners();
    child.kill();
  }

  private scheduleRestart(): void {
    if (!this.running || this.restartTimer) return;
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      this.startUdevMonitor();
    }, MONITOR_RESTART_MS);
    this.restartTimer.unref();
  }

  /**
   * Parses one udev monitor line:
   *   `KERNEL[1234.567] add      /devices/.../block/sr0 (block)`
   *   `UDEV  [1234.578] change   /devices/.../block/sr0 (block)`
   * Both the kernel and the processed udev line are used; the debounce below
   * collapses the pair into a single probe.
   */
  private onUdevLine(line: string): void {
    const match = /^(?:KERNEL|UDEV)\s+\[\d+(?:\.\d+)?\]\s+([a-z-]+)\s+(\S+)\s+\((\w+)\)/.exec(line);
    if (!match) return;
    const [, action, devicePath, subsystem] = match;
    if (subsystem !== "block") return;
    if (!/(?:^|\/)sr\d+$/.test(devicePath)) return;
    if (action !== "add" && action !== "remove" && action !== "change") return;
    this.scheduleProbe();
  }

  private scheduleProbe(): void {
    if (this.debounceTimer) return;
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      this.poll();
    }, EVENT_DEBOUNCE_MS);
    this.debounceTimer.unref();
  }

  /** Last resort when udev events are not available on this system. */
  private enableFallback(reason?: string): void {
    if (this.fallbackActive || !this.running) return;
    this.fallbackActive = true;
    this.logger.warn(
      `falling back to ${FALLBACK_POLL_MS / 1000}s drive polling${reason ? ` (${reason})` : ""}`,
    );
    this.fallbackTimer = setInterval(() => this.poll(), FALLBACK_POLL_MS);
    this.fallbackTimer.unref();
  }

  /* -------------------------------- probing ------------------------------- */

  private poll(): void {
    try {
      const next = this.probe();
      const prev = this.snapshot;
      if (prev.device !== next.device || prev.hasMedia !== next.hasMedia) {
        this.snapshot = next;
        this.logger.log(`drive ${next.device ?? "none"} media=${next.hasMedia ? "present" : "absent"}`);
        this.emit("changed", next);
      }
    } catch (error) {
      this.logger.warn("probe failed:", errorMessage(error));
    }
  }

  private probe(): DriveSnapshot {
    const devices = enumerateCdromDevices();
    let device: string | null =
      this.preferredDevice && devices.includes(this.preferredDevice)
        ? this.preferredDevice
        : (devices[0] ?? null);

    // A preferred device may exist as a node but not be listed (e.g. udev
    // alias like /dev/cdrom); still honor it when it resolves.
    if (!device && this.preferredDevice) {
      try {
        fs.realpathSync(this.preferredDevice);
        device = this.preferredDevice;
      } catch {
        device = null;
      }
    }

    if (!device) return { device: null, hasMedia: false };
    return { device, hasMedia: hasMedia(device) };
  }

  private clearTimer(key: "debounceTimer" | "fallbackTimer" | "restartTimer"): void {
    const timer = this[key];
    if (timer) clearTimeout(timer);
    this[key] = null;
  }
}

function enumerateCdromDevices(): string[] {
  const names = new Set<string>();

  try {
    const info = fs.readFileSync("/proc/sys/dev/cdrom/info", "utf8");
    for (const line of info.split("\n")) {
      const match = /^drive name:\s+(.+)$/.exec(line);
      if (match) {
        for (const name of match[1].trim().split(/\s+/)) {
          names.add(`/dev/${name}`);
        }
      }
    }
  } catch {
    // procfs entry missing — fall through to sysfs enumeration
  }

  try {
    for (const entry of fs.readdirSync("/sys/block")) {
      if (/^sr\d+$/.test(entry)) names.add(`/dev/${entry}`);
    }
  } catch {
    // sysfs unavailable — nothing more we can do
  }

  return [...names];
}

/**
 * Media presence via the udev database (authoritative, updated by kernel
 * events), falling back to the sysfs block size. Some drives report a bogus
 * non-zero size with an empty tray, so sysfs alone is not trusted.
 */
function hasMedia(device: string): boolean {
  const props = readUdevProperties(device);
  if (props) return props.ID_CDROM_MEDIA === "1";
  return readMediaSize(device) > 0;
}

/** Shared helper used by both drive probing and disc identification. */
export function readUdevProperties(device: string): Record<string, string> | null {
  const run = spawnSync(UDEVADM, ["info", "-q", "property", "-n", device], {
    encoding: "utf8",
    timeout: SPAWN_TIMEOUT_MS,
  });
  if (run.status !== 0 || !run.stdout) return null;

  const props: Record<string, string> = {};
  for (const line of run.stdout.split("\n")) {
    const eq = line.indexOf("=");
    if (eq > 0) props[line.slice(0, eq)] = line.slice(eq + 1).trim();
  }
  return Object.keys(props).length > 0 ? props : null;
}

function readMediaSize(device: string): number {
  try {
    const base = path.basename(fs.realpathSync(device));
    const raw = fs.readFileSync(`/sys/block/${base}/size`, "utf8").trim();
    return Number(raw) || 0;
  } catch {
    return 0;
  }
}
