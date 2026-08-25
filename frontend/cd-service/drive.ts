import { EventEmitter } from "node:events";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { logger } from "./logger.js";

const POLL_MS = 2000;
const SPAWN_TIMEOUT_MS = 5000;

export interface DriveSnapshot {
  device: string | null;
  hasMedia: boolean;
}

/**
 * Watches Linux optical drives (USB CD/DVD units show up as /dev/srN).
 *
 * Detection is fully dependency-free:
 * - drives are enumerated from /proc/sys/dev/cdrom/info + /sys/block/srN
 * - media presence is read from /sys/block/srN/size (0 = no disc / tray open)
 *
 * The drive is polled so hot-plugging the USB unit and inserting/ejecting a
 * disc are both picked up without needing udev or netlink listeners.
 */
export class DriveMonitor extends EventEmitter {
  private timer: NodeJS.Timeout | null = null;
  private snapshot: DriveSnapshot = { device: null, hasMedia: false };

  constructor(private readonly preferredDevice?: string | null) {
    super();
  }

  start(): void {
    if (this.timer) return;
    this.poll();
    this.timer = setInterval(() => this.poll(), POLL_MS);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  getSnapshot(): DriveSnapshot {
    return this.snapshot;
  }

  private poll(): void {
    try {
      const next = this.probe();
      const prev = this.snapshot;
      if (prev.device !== next.device || prev.hasMedia !== next.hasMedia) {
        this.snapshot = next;
        logger.log(
          `drive ${next.device ?? "none"} media=${next.hasMedia ? "present" : "absent"}`,
        );
        this.emit("changed", next);
      }
    } catch (error) {
      logger.warn(
        "probe failed:",
        error instanceof Error ? error.message : error,
      );
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
export function readUdevProperties(
  device: string,
): Record<string, string> | null {
  const run = spawnSync("udevadm", ["info", "-q", "property", "-n", device], {
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
