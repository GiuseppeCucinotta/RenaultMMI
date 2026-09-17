/**
 * Pure helpers that translate raw BlueZ device properties into the vocabulary
 * the UI speaks: what kind of thing a device is, whether it belongs in the
 * phone list, and which profiles it supports.
 *
 * Bluetooth Class of Device (CoD) layout, 24 bits:
 *   bits 0-1   format version
 *   bits 2-7   minor device class (meaning depends on the major class)
 *   bits 8-12  major device class
 *   bits 13-23 service classes (bit 21 = audio, bit 20 = telephony, ...)
 */
import type { BluetoothCapabilities, BluetoothDeviceKind } from "./types.js";

const MAJOR_MASK = 0x1f;
const MINOR_MASK = 0x3f;

export const MAJOR_COMPUTER = 0x01;
export const MAJOR_PHONE = 0x02;
export const MAJOR_AUDIO_VIDEO = 0x04;
export const MAJOR_PERIPHERAL = 0x05;
export const MAJOR_IMAGING = 0x06;

/** Audio/Video major, minor 5 = "wearable headset", 6 = "hands-free", 7 = "portable audio". */
const AV_MINOR_WEARABLE_HEADSET = 0x05;
const AV_MINOR_HANDSFREE = 0x06;
const AV_MINOR_MICROPHONE = 0x08;

const SERVICE_BIT_AUDIO = 0x200000;
const SERVICE_BIT_TELEPHONY = 0x400000;

export const UUID_A2DP_SOURCE = "0000110a-0000-1000-8000-00805f9b34fb";
export const UUID_A2DP_SINK = "0000110b-0000-1000-8000-00805f9b34fb";
export const UUID_AVRCP_TARGET = "0000110c-0000-1000-8000-00805f9b34fb";
export const UUID_AVRCP = "0000110e-0000-1000-8000-00805f9b34fb";
export const UUID_HANDSFREE = "0000111e-0000-1000-8000-00805f9b34fb";
export const UUID_HANDSFREE_AG = "0000111f-0000-1000-8000-00805f9b34fb";
export const UUID_HFP_HS = "0000111e-0000-1000-8000-00805f9b34fb";
export const UUID_PHONEBOOK_ACCESS = "0000112f-0000-1000-8000-00805f9b34fb";
export const UUID_MESSAGE_ACCESS = "00001132-0000-1000-8000-00805f9b34fb";

const AUDIO_UUIDS = new Set([UUID_A2DP_SOURCE, UUID_A2DP_SINK]);
const REMOTE_CONTROL_UUIDS = new Set([UUID_AVRCP, UUID_AVRCP_TARGET]);
const HANDS_FREE_UUIDS = new Set([UUID_HANDSFREE, UUID_HANDSFREE_AG, UUID_PHONEBOOK_ACCESS, UUID_MESSAGE_ACCESS]);

/** Events the service cares about in Device1 properties. */
export interface BluezDeviceSnapshot {
  path: string;
  address: string;
  alias: string;
  name: string | null;
  connected: boolean;
  paired: boolean;
  trusted: boolean;
  blocked: boolean;
  rssi: number | null;
  classOfDevice: number | null;
  /** Battery1 percentage, when the phone exposes it. */
  batteryPercent: number | null;
  /** BlueZ `Adapter1` path this device belongs to. */
  adapterPath: string;
  uuids: string[];
}

export function emptyCapabilities(): BluetoothCapabilities {
  return { audio: false, remoteControl: false, handsFree: false, battery: false };
}

export function majorClass(classOfDevice: number | null): number | null {
  if (classOfDevice == null || !Number.isFinite(classOfDevice)) return null;
  return (classOfDevice >> 8) & MAJOR_MASK;
}

export function minorClass(classOfDevice: number | null): number | null {
  if (classOfDevice == null || !Number.isFinite(classOfDevice)) return null;
  return (classOfDevice >> 2) & MINOR_MASK;
}

/**
 * Coarse classification of a device. Unknown class data degrades to `other`
 * rather than guessing, so a phone that hides its class is never mislabelled.
 */
export function classifyDeviceKind(classOfDevice: number | null): BluetoothDeviceKind {
  const major = majorClass(classOfDevice);
  if (major === MAJOR_PHONE) return "phone";
  if (major === MAJOR_AUDIO_VIDEO) {
    const minor = minorClass(classOfDevice);
    // Headsets and hands-free kits identify as audio/video but are not phones.
    if (
      minor === AV_MINOR_WEARABLE_HEADSET ||
      minor === AV_MINOR_HANDSFREE ||
      minor === AV_MINOR_MICROPHONE
    ) {
      return "audio";
    }
    return "audio";
  }
  if (major === MAJOR_COMPUTER) return "computer";
  return "other";
}

export interface DeviceCapabilityInput {
  uuids: string[];
  classOfDevice: number | null;
  batteryPercent: number | null;
  /** Whether this device exposes `org.bluez.MediaPlayer1`. */
  hasMediaPlayer: boolean;
}

export function capabilitiesOf(input: DeviceCapabilityInput): BluetoothCapabilities {
  const uuids = new Set(input.uuids);
  const major = majorClass(input.classOfDevice);
  const serviceAudio = ((input.classOfDevice ?? 0) & SERVICE_BIT_AUDIO) !== 0;
  const serviceTelephony = ((input.classOfDevice ?? 0) & SERVICE_BIT_TELEPHONY) !== 0;
  const isPhone = major === MAJOR_PHONE;
  const handsFree = [...uuids].some((uuid) => HANDS_FREE_UUIDS.has(uuid));
  return {
    audio:
      [...uuids].some((uuid) => AUDIO_UUIDS.has(uuid)) ||
      input.hasMediaPlayer ||
      serviceAudio,
    remoteControl:
      [...uuids].some((uuid) => REMOTE_CONTROL_UUIDS.has(uuid)) || input.hasMediaPlayer,
    handsFree: handsFree || (isPhone && serviceTelephony),
    battery: input.batteryPercent != null,
  };
}

export interface PhoneListFilterOptions {
  /** Show every known device, including computers and headsets. */
  showAll: boolean;
}

/**
 * Whether a device belongs in the "connect your phone" list.
 *
 * Paired devices are always listed — hiding something the user already paired
 * would make it impossible to reconnect or forget. Unpaired devices must look
 * like a phone or carry a telephony/audio service bit; the `showAll` escape
 * hatch exists because a phone that hides its class would otherwise be
 * invisible with no way to recover from the UI.
 */
export function isPhoneCandidate(
  device: BluezDeviceSnapshot,
  options: PhoneListFilterOptions = { showAll: false },
): boolean {
  if (device.blocked) return false;
  if (device.paired) return true;
  if (options.showAll) return device.name !== null || device.alias !== "";
  const kind = classifyDeviceKind(device.classOfDevice);
  if (kind === "phone") return true;
  const caps = capabilitiesOf({
    uuids: device.uuids,
    classOfDevice: device.classOfDevice,
    batteryPercent: null,
    hasMediaPlayer: false,
  });
  return caps.handsFree || caps.audio;
}

/** BlueZ `Adapter1` properties, narrowed to what the service exposes. */
export interface BluezAdapterSnapshot {
  path: string;
  name: string | null;
  address: string | null;
  powered: boolean;
  discoverable: boolean;
  pairable: boolean;
  discovering: boolean;
}

export function toAdapterSnapshot(
  path: string,
  props: Record<string, unknown>,
): BluezAdapterSnapshot {
  const alias = props.Alias ?? props.Name;
  return {
    path,
    name: typeof alias === "string" && alias ? alias : null,
    address: typeof props.Address === "string" ? props.Address : null,
    powered: Boolean(props.Powered),
    discoverable: Boolean(props.Discoverable),
    pairable: Boolean(props.Pairable),
    discovering: Boolean(props.Discovering),
  };
}
