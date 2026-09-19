import { EventEmitter } from "node:events";
import { IDLE_PAIRING } from "../bluetooth-service/types.js";
import type { BluezPlayer } from "../bluetooth-service/bluez.js";
import type { BluezDeviceSnapshot } from "../bluetooth-service/devices.js";

import type { BluetoothAdapter, BluetoothPairing } from "../bluetooth-service/types.js";

export const ADAPTER: BluetoothAdapter = {
  path: "/org/bluez/hci0",
  name: "test-adapter",
  address: "00:11:22:33:44:55",
  powered: true,
  discoverable: false,
  pairable: false,
  discovering: false,
};

export function device(
  overrides: Partial<BluezDeviceSnapshot> & Pick<BluezDeviceSnapshot, "path">,
): BluezDeviceSnapshot {
  return {
    address: overrides.path.split("dev_").pop()?.replace(/_/g, ":") ?? "00:00:00:00:00:00",
    alias: "Phone",
    name: null,
    connected: false,
    paired: false,
    trusted: false,
    blocked: false,
    rssi: null,
    classOfDevice: 0x5a020c, // major device class 2 = phone
    batteryPercent: null,
    adapterPath: "/org/bluez/hci0",
    uuids: ["0000110e-0000-1000-8000-00805f9b34fb"],
    ...overrides,
  };
}

export function player(
  devicePath: string,
  overrides: Partial<BluezPlayer> = {},
): BluezPlayer {
  return {
    path: `${devicePath}/avrcp/player0`,
    devicePath,
    name: "Music",
    status: "paused",
    track: {
      title: "Something",
      artist: "Someone",
      album: "Somewhere",
      durationMs: 200_000,
      imgHandle: null,
    },
    positionMs: 0,
    positionAt: Date.now(),
    obexPort: null,
    ...overrides,
  };
}

/**
 * Structural stand-in for {@link BlueZClient}.
 *
 * It records the calls the managers make and lets a test drive the events BlueZ
 * would emit, so pairing policy and state mapping are testable with no system
 * bus and no Bluetooth hardware.
 */
export class FakeBluez extends EventEmitter {
  available = true;
  discovering = false;
  pairable = false;
  discoverable = false;
  devices: BluezDeviceSnapshot[] = [];
  players = new Map<string, BluezPlayer>();
  connectedCalls: string[] = [];
  private attempts: string[] = [];
  forgotten: string[] = [];
  trustedCalls: Array<{ path: string; trusted: boolean }> = [];
  pairCalls: string[] = [];
  cancelCalls: string[] = [];
  resyncs = 0;
  /** When set, device calls reject with this error. */
  failWith: Error | null = null;
  /** What BlueZ does when pairing is confirmed by the user. */
  onPairConfirmed: (devicePath: string) => void = (devicePath) => this.markConnected(devicePath);

  isAvailable(): boolean {
    return this.available;
  }

  getBus(): null {
    return null;
  }

  async connect(): Promise<void> {
    this.available = true;
  }

  async disconnect(): Promise<void> {
    this.available = false;
  }

  getAdapter(): BluetoothAdapter {
    return {
      ...ADAPTER,
      discovering: this.discovering,
      pairable: this.pairable,
      discoverable: this.discoverable,
    };
  }

  getDevices(): BluezDeviceSnapshot[] {
    return [...this.devices];
  }

  getDevice(id: string): BluezDeviceSnapshot | null {
    return this.devices.find((candidate) => candidate.path === id) ?? null;
  }

  getPlayersForDevice(devicePath: string): BluezPlayer[] {
    const found = this.players.get(devicePath);
    return found ? [found] : [];
  }

  getPlayer(playerPath: string): BluezPlayer | null {
    for (const item of this.players.values()) {
      if (item.path === playerPath) return item;
    }
    return null;
  }

  getActiveDevice(): BluezDeviceSnapshot | null {
    for (const item of this.players.values()) {
      const owner = this.getDevice(item.devicePath);
      if (owner?.connected) return owner;
    }
    return this.devices.find((candidate) => candidate.connected && candidate.paired) ?? null;
  }

  getActivePlayer(): BluezPlayer | null {
    const active = this.getActiveDevice();
    return active ? (this.players.get(active.path) ?? null) : null;
  }

  async startDiscovery(): Promise<boolean> {
    this.discovering = true;
    this.emit("changed");
    return true;
  }

  async stopDiscovery(): Promise<boolean> {
    this.discovering = false;
    this.emit("discovery-stopped");
    return true;
  }

  async setPairable(value: boolean): Promise<boolean> {
    this.pairable = value;
    return true;
  }

  async setDiscoverable(value: boolean): Promise<boolean> {
    this.discoverable = value;
    return true;
  }

  async resyncNow(): Promise<void> {
    this.resyncs += 1;
    this.emit("changed");
  }

  async pairDevice(devicePath: string): Promise<void> {
    if (this.failWith) throw this.failWith;
    this.pairCalls.push(devicePath);
    this.onPairConfirmed(devicePath);
  }

  async connectDevice(devicePath: string): Promise<void> {
    if (this.failWith) throw this.failWith;
    this.attempts.push(devicePath);
    this.markConnected(devicePath);
  }

  async disconnectDevice(devicePath: string): Promise<void> {
    const target = this.getDevice(devicePath);
    if (target) target.connected = false;
    this.emit("device-disconnected", devicePath);
    this.emit("changed");
  }

  async forgetDevice(devicePath: string): Promise<void> {
    this.forgotten.push(devicePath);
    this.devices = this.devices.filter((candidate) => candidate.path !== devicePath);
    this.players.delete(devicePath);
    this.emit("changed");
  }

  async setDeviceTrusted(devicePath: string, trusted: boolean): Promise<boolean> {
    this.trustedCalls.push({ path: devicePath, trusted });
    const target = this.getDevice(devicePath);
    if (target) target.trusted = trusted;
    this.emit("changed");
    return true;
  }

  async cancelPairing(devicePath: string): Promise<void> {
    this.cancelCalls.push(devicePath);
  }

  async play(): Promise<void> {}
  async pause(): Promise<void> {}
  async next(): Promise<void> {}
  async previous(): Promise<void> {}
  async stop(): Promise<void> {}

  /* ------------------------------ test helpers ----------------------------- */

  addDevice(snapshot: BluezDeviceSnapshot): void {
    this.devices = [...this.devices, snapshot];
    this.emit("changed");
  }

  removeDevice(devicePath: string): void {
    this.devices = this.devices.filter((candidate) => candidate.path !== devicePath);
    this.emit("changed");
  }

  /** Records one successful connection (not one Connect() attempt). */
  markConnected(devicePath: string, withPlayer: BluezPlayer | null = null): void {
    const target = this.getDevice(devicePath);
    if (!target) return;
    const wasConnected = target.connected;
    target.connected = true;
    target.paired = true;
    if (withPlayer) this.players.set(devicePath, withPlayer);
    if (!wasConnected) this.connectedCalls.push(devicePath);
    this.emit("device-connected", devicePath);
    this.emit("changed");
  }

  /** Every Connect() call, including reconnects of an already-connected phone. */
  get connectAttempts(): string[] {
    return this.attempts;
  }

  simulateDisconnection(devicePath: string): void {
    const target = this.getDevice(devicePath);
    if (target) target.connected = false;
    this.players.delete(devicePath);
    this.emit("device-disconnected", devicePath);
    this.emit("changed");
  }
}

/** Stand-in for {@link PairingAgent}: the test raises the prompts. */
export class FakeAgent extends EventEmitter {
  registered = false;
  unregistered = false;
  confirms: boolean[] = [];
  rejections = 0;
  passkeys: string[] = [];
  pins: string[] = [];
  deviceNames = new Map<string, string>();
  /** Makes a registered agent report that it cannot prompt. */
  cannotPrompt = false;

  canPrompt(): boolean {
    return this.registered && !this.cannotPrompt;
  }

  async register(): Promise<boolean> {
    this.registered = true;
    return true;
  }

  async unregister(): Promise<void> {
    this.unregistered = true;
    this.registered = false;
  }

  confirm(accept: boolean): boolean {
    if (!this.registered) return false;
    this.confirms.push(accept);
    return true;
  }

  reject(): boolean {
    if (!this.registered) return false;
    this.rejections += 1;
    return true;
  }

  replyPasskey(passkey: string): boolean {
    this.passkeys.push(passkey);
    return true;
  }

  replyPin(pin: string): boolean {
    this.pins.push(pin);
    return true;
  }

  setDeviceNames(names: Map<string, string>): void {
    this.deviceNames = names;
  }

  raisePrompt(
    kind: "confirmation" | "passkey" | "authorization",
    devicePath: string,
    passkey = "123456",
  ): void {
    const base = { kind, device: { path: devicePath, name: this.deviceNames.get(devicePath) ?? null } };
    if (kind === "authorization") {
      this.emit("prompt", { ...base, uuid: "0000110e-0000-1000-8000-00805f9b34fb" });
      return;
    }
    this.emit("prompt", { ...base, passkey });
  }
}

export { IDLE_PAIRING };
export type { BluetoothPairing };
