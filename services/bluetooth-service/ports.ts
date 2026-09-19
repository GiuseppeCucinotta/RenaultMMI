import type { BlueZClient, BluezPlayer } from "./bluez.js";
import type { PairingAgent } from "./agent.js";

/**
 * Server-side ports.
 *
 * Each manager declares the slice of {@link BlueZClient} it actually drives, so
 * a fake can be substituted in tests without dragging a D-Bus connection — or
 * the 400 lines of `BlueZClient` — along. The real client satisfies all of them
 * structurally, so production wiring needs no cast.
 */

/**
 * A plain subscription surface. BlueZClient narrows `on` to the events it
 * emits; managers only need "subscribe and receive", so the port widens the
 * listener type back to the `EventEmitter` shape.
 */
export interface EventPort {
  // `any` is what `EventEmitter` itself declares; narrowing it here would make
  // every real emitter (and every fake) structurally incompatible.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on(event: string, listener: (...args: any[]) => void): unknown;
}

/** Discovery, adapter and device lifecycle: the phone/pairing surface. */
export type BluezDevicePort = Omit<
  Pick<
    BlueZClient,
    | "connect"
  | "disconnect"
  | "isAvailable"
  | "getAdapter"
  | "getDevices"
  | "getDevice"
  | "startDiscovery"
  | "stopDiscovery"
  | "setPairable"
  | "setDiscoverable"
  | "resyncNow"
  | "connectDevice"
  | "disconnectDevice"
  | "forgetDevice"
    | "setDeviceTrusted"
    | "pairDevice"
    | "cancelPairing"
  >,
  "on"
> &
  EventPort;

/** AVRCP playback: what the media read model needs. */
export type BluezMediaPort = Pick<
  BlueZClient,
  | "getPlayer"
  | "getPlayersForDevice"
  | "getActiveDevice"
  | "play"
  | "pause"
  | "next"
  | "previous"
  | "stop"
>;

/** Device/player reads the cover-art downloader needs. */
export type BluezArtworkPort = Pick<BlueZClient, "getActiveDevice" | "getActivePlayer"> & EventPort;

/** The union the phone manager composes, plus its two extra hooks. */
export type BluezPort = BluezDevicePort &
  BluezMediaPort &
  BluezArtworkPort & {
    getBus?: () => Parameters<PairingAgent["register"]>[0] | null;
  };

/** The pairing agent surface the manager needs. */
export type AgentPort = Omit<
  Pick<
    PairingAgent,
    | "register"
    | "unregister"
    | "canPrompt"
    | "confirm"
    | "reject"
    | "replyPasskey"
    | "replyPin"
    | "setDeviceNames"
  >,
  never
> &
  EventPort;

export type { BluezPlayer };
