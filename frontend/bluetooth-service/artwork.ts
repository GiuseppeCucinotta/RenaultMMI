import { EventEmitter } from "node:events";
import fsp from "node:fs/promises";
import path from "node:path";
import * as dbus from "dbus-next";
import type { MessageBus } from "dbus-next";
import type { BlueZClient } from "./bluez.js";
import { logger } from "./logger.js";

const OBEX_SERVICE = "org.bluez.obex";
const OBEX_CLIENT_PATH = "/org/bluez/obex";
const OBEX_IMAGE_IFACE = "org.bluez.obex.Image1";
const OBEX_BIPAVRCP_IFACE = "org.bluez.obex.BipAvrcp1";
const OBEX_TRANSFER_IFACE = "org.bluez.obex.Transfer1";
const PROPERTIES_IFACE = "org.freedesktop.DBus.Properties";

const HANDLE_PATTERN = /^[A-Za-z0-9_-]+$/;
const TRANSFER_POLL_MS = 250;
const TRANSFER_TIMEOUT_MS = 15000;
const CACHE_MAX_FILES = 64;

interface ObexSession {
  address: string;
  port: number;
  path: string;
}

async function callObex(bus: MessageBus, message: dbus.Message): Promise<dbus.Message> {
  const reply = await bus.call(message);
  if (!reply) throw new Error("no reply from obexd");
  return reply;
}

/**
 * Fetches cover art thumbnails from the connected phone over AVRCP 1.6
 * Cover Art (BIP/OBEX), for both Android and iOS.
 *
 * Requires experimental BlueZ >= 5.79 (`bluetoothd --experimental`, which adds
 * the MediaPlayer1 `ObexPort` property) plus a running obexd with the
 * bip-avrcp client. When any of those is missing this service stays idle and
 * the UI keeps showing placeholder art.
 */
export class ArtworkService extends EventEmitter {
  private readonly bluez: BlueZClient;
  private readonly cacheDir: string;
  private bus: MessageBus | null = null;
  private available = new Set<string>();
  private session: ObexSession | null = null;
  private creatingSession = false;
  private lastRequestedHandle: string | null = null;
  private lastSyncDebug = "";

  constructor(bluez: BlueZClient, cacheDir: string) {
    super();
    this.bluez = bluez;
    this.cacheDir = cacheDir;
  }

  isAvailable(handle: string | null): boolean {
    return handle != null && this.available.has(handle);
  }

  async start(): Promise<void> {
    await fsp.mkdir(this.cacheDir, { recursive: true });
    await this.scanCache();

    try {
      this.bus = dbus.sessionBus();
      this.bus.on("error", (error: unknown) => {
        logger.error("obex dbus bus error:", error instanceof Error ? error.message : error);
      });
    } catch (error) {
      // No session bus (e.g. headless run without obexd) -> stay idle
      logger.warn(
        "session bus unavailable, cover art disabled:",
        error instanceof Error ? error.message : error,
      );
    }

    this.bluez.on("changed", () => void this.sync());
    this.bluez.on("device-disconnected", () => void this.teardown());
    this.bluez.on("bluez-unavailable", () => void this.teardown());
    // The player may already be up when we start (e.g. service restart).
    await this.sync();
  }

  private async scanCache(): Promise<void> {
    try {
      const entries = await fsp.readdir(this.cacheDir);
      for (const entry of entries) {
        if (!entry.endsWith(".jpg")) continue;
        const handle = entry.slice(0, -4);
        if (HANDLE_PATTERN.test(handle)) this.available.add(handle);
      }
      logger.log(`artwork cache: ${this.available.size} file(s) in ${this.cacheDir}`);
    } catch (error) {
      logger.error("artwork cache scan failed:", error instanceof Error ? error.message : error);
    }
  }

  private async sync(): Promise<void> {
    const device = this.bluez.getActiveDevice();
    const player = this.bluez.getActivePlayer();
    const handle = player?.track.imgHandle ?? null;
    const port = player?.obexPort ?? null;

    const debugKey = [
      `device=${device?.address ?? "-"}`,
      `obexPort=${port ?? "-"}`,
      `imgHandle=${handle ?? "-"}`,
      `session=${this.session?.path ?? "-"}`,
      `cached=${this.available.size}`,
    ].join(" ");
    if (debugKey !== this.lastSyncDebug) {
      this.lastSyncDebug = debugKey;
      logger.log(`artwork sync: ${debugKey}`);
    }

    if (!device || !port) {
      await this.teardown();
      return;
    }

    if (!this.session || this.session.address !== device.address || this.session.port !== port) {
      await this.connectSession(device.address, port);
      if (!this.session) return;
    }

    if (!handle || handle === this.lastRequestedHandle) return;
    this.lastRequestedHandle = handle;

    if (this.isAvailable(handle)) {
      this.emit("downloaded", handle);
      return;
    }
    await this.download(handle);
  }

  private async connectSession(address: string, port: number): Promise<void> {
    if (this.creatingSession || !this.bus) return;
    this.creatingSession = true;
    try {
      const message = new dbus.Message({
        destination: OBEX_SERVICE,
        path: OBEX_CLIENT_PATH,
        interface: "org.bluez.obex.Client1",
        member: "CreateSession",
        type: dbus.MessageType.METHOD_CALL,
        signature: "sa{sv}",
        body: [
          address,
          {
            Target: new dbus.Variant("s", "bip-avrcp"),
            PSM: new dbus.Variant("q", port),
          },
        ],
      });
      const reply = await callObex(this.bus, message);
      const sessionPath = String(reply.body[0]);
      this.session = { address, port, path: sessionPath };
      logger.log(`obex bip-avrcp session open for ${address} (psm ${port})`);
    } catch (error) {
      logger.error(
        "obex CreateSession failed (is obexd running? bluetoothd --experimental?):",
        error instanceof Error ? error.message : error,
      );
      this.session = null;
    } finally {
      this.creatingSession = false;
    }
  }

  private async download(handle: string): Promise<void> {
    const session = this.session;
    const bus = this.bus;
    if (!session || !bus) return;
    if (!HANDLE_PATTERN.test(handle)) return;

    const finalPath = path.join(this.cacheDir, `${handle}.jpg`);
    const tmpPath = `${finalPath}.tmp`;

    const attempts = [
      {
        label: "native",
        interface: OBEX_IMAGE_IFACE,
        member: "Get",
        signature: "ssa{sv}",
        body: [tmpPath, handle, {}] as unknown[],
      },
      {
        label: "thumbnail",
        interface: OBEX_BIPAVRCP_IFACE,
        member: "GetImageThumbnail",
        signature: "ss",
        body: [tmpPath, handle] as unknown[],
      },
    ];

    let lastError: unknown = null;
    for (const attempt of attempts) {
      try {
        const message = new dbus.Message({
          destination: OBEX_SERVICE,
          path: session.path,
          interface: attempt.interface,
          member: attempt.member,
          type: dbus.MessageType.METHOD_CALL,
          signature: attempt.signature,
          body: attempt.body,
        });
        const reply = await callObex(bus, message);
        const transferPath = String(reply.body[0]);
        const initialStatus = this.statusFromProps(reply.body[1]);
        logger.log(
          `artwork download started (${attempt.label}): handle ${handle} -> ${transferPath}` +
            (initialStatus ? ` (status: ${initialStatus})` : ""),
        );

        await this.waitForTransfer(transferPath, initialStatus, tmpPath);

        await fsp.rename(tmpPath, finalPath);
        this.available.add(handle);
        logger.log(`cover art saved: ${finalPath}`);
        void this.evict();
        this.emit("downloaded", handle);
        return;
      } catch (error) {
        lastError = error;
        logger.warn(
          `artwork ${attempt.label} attempt failed:`,
          error instanceof Error ? error.message : error,
        );
      }
    }

    logger.error(
      "artwork download failed:",
      lastError instanceof Error ? lastError.message : String(lastError),
    );
    await fsp.rm(tmpPath, { force: true }).catch(() => {});
  }

  private statusFromProps(props: unknown): string | null {
    if (props == null || typeof props !== "object") return null;
    const status = (props as Record<string, unknown>).Status;
    if (status == null) return null;
    return String((status as { value?: unknown }).value ?? status);
  }

  private waitForTransfer(
    transferPath: string,
    lastKnown: string | null,
    tmpPath: string,
  ): Promise<void> {
    const bus = this.bus;
    if (!bus) return Promise.reject(new Error("no obex bus"));
    const deadline = Date.now() + TRANSFER_TIMEOUT_MS;

    return new Promise((resolve, reject) => {
      const finish = async (): Promise<void> => {
        // The object is gone: success only if the payload landed on disk
        try {
          const stat = await fsp.stat(tmpPath);
          if (stat.size > 0) {
            resolve();
            return;
          }
        } catch {
          // no file
        }
        reject(new Error(`transfer ended before completing (last status: ${lastKnown ?? "unknown"})`));
      };

      const poll = async (): Promise<void> => {
        try {
          const message = new dbus.Message({
            destination: OBEX_SERVICE,
            path: transferPath,
            interface: PROPERTIES_IFACE,
            member: "Get",
            type: dbus.MessageType.METHOD_CALL,
            signature: "ss",
            body: [OBEX_TRANSFER_IFACE, "Status"],
          });
          const reply = await callObex(bus, message);
          const status = String((reply.body[0] as { value?: unknown })?.value ?? reply.body[0]);
          if (status !== lastKnown) {
            lastKnown = status;
            logger.log(`artwork transfer ${transferPath}: status=${status}`);
          }
          if (status === "complete") {
            resolve();
            return;
          }
          if (status === "error" || status === "canceled") {
            reject(new Error(`transfer ${status}`));
            return;
          }
        } catch {
          await finish();
          return;
        }
        if (Date.now() > deadline) {
          reject(new Error(`transfer timed out (last status: ${lastKnown ?? "unknown"})`));
          return;
        }
        setTimeout(() => void poll(), TRANSFER_POLL_MS);
      };
      void poll();
    });
  }

  private async evict(): Promise<void> {
    if (this.available.size <= CACHE_MAX_FILES) return;
    try {
      const entries = await fsp.readdir(this.cacheDir);
      const stats = await Promise.all(
        entries
          .filter((entry) => entry.endsWith(".jpg"))
          .map(async (entry) => {
            const full = path.join(this.cacheDir, entry);
            const stat = await fsp.stat(full);
            return { full, handle: entry.slice(0, -4), mtime: stat.mtimeMs };
          }),
      );
      stats.sort((a, b) => b.mtime - a.mtime);
      for (const stale of stats.slice(CACHE_MAX_FILES)) {
        await fsp.rm(stale.full, { force: true }).catch(() => {});
        this.available.delete(stale.handle);
      }
    } catch (error) {
      logger.warn("cache eviction failed:", error instanceof Error ? error.message : error);
    }
  }

  private async teardown(): Promise<void> {
    this.lastRequestedHandle = null;
    const session = this.session;
    this.session = null;
    if (session && this.bus) {
      try {
        const message = new dbus.Message({
          destination: OBEX_SERVICE,
          path: OBEX_CLIENT_PATH,
          interface: "org.bluez.obex.Client1",
          member: "RemoveSession",
          type: dbus.MessageType.METHOD_CALL,
          signature: "o",
          body: [session.path],
        });
        await this.bus.call(message);
      } catch {
        // Session may already be gone with the device
      }
      logger.log("obex session closed");
    }
  }
}
