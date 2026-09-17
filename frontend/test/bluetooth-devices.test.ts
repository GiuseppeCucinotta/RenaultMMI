import assert from "node:assert/strict";
import { test } from "node:test";
import {
  capabilitiesOf,
  classifyDeviceKind,
  isPhoneCandidate,
  majorClass,
  toAdapterSnapshot,
} from "../bluetooth-service/devices.js";
import { device } from "./fake-bluez.js";

/* ------------------------------- classification ---------------------------- */

test("class of device majors map to the right kind", () => {
  assert.equal(classifyDeviceKind(0x5a020c), "phone"); // smart phone
  assert.equal(classifyDeviceKind(0x240404), "audio"); // wearable headset
  assert.equal(classifyDeviceKind(0x240408), "audio"); // hands-free kit
  assert.equal(classifyDeviceKind(0x10010c), "computer"); // laptop
  assert.equal(classifyDeviceKind(0x000000), "other");
  assert.equal(classifyDeviceKind(null), "other");
  assert.equal(majorClass(0x5a020c), 0x02);
});

/* ------------------------------- phone filter ------------------------------ */

test("paired devices are always listed, whatever they are", () => {
  const laptop = device({ path: "/org/bluez/hci0/dev_AA", paired: true, classOfDevice: 0x10010c });
  assert.equal(isPhoneCandidate(laptop), true);
});

test("nearby candidates need a phone or a telephony/audio service bit", () => {
  const phone = device({ path: "/org/bluez/hci0/dev_AA" });
  const headset = device({
    path: "/org/bluez/hci0/dev_BB",
    classOfDevice: 0x240404,
  });
  const laptop = device({ path: "/org/bluez/hci0/dev_CC", classOfDevice: 0x10010c });
  const mystery = device({
    path: "/org/bluez/hci0/dev_DD",
    classOfDevice: null,
    uuids: [],
  });

  assert.equal(isPhoneCandidate(phone), true, "a phone belongs in the list");
  assert.equal(isPhoneCandidate(headset), true, "a hands-free kit can be paired too");
  assert.equal(isPhoneCandidate(laptop), false, "a laptop is not a phone");
  assert.equal(isPhoneCandidate(mystery), false, "an unclassified device is not guessed");
});

test("the showAll escape hatch lists a phone that hides its class", () => {
  const hidden = device({
    path: "/org/bluez/hci0/dev_EE",
    classOfDevice: null,
    uuids: [],
    name: "Mystery Phone",
  });
  assert.equal(isPhoneCandidate(hidden), false);
  assert.equal(isPhoneCandidate(hidden, { showAll: true }), true);
});

test("blocked devices never appear", () => {
  const blocked = device({ path: "/org/bluez/hci0/dev_FF", paired: true, blocked: true });
  assert.equal(isPhoneCandidate(blocked), false);
  assert.equal(isPhoneCandidate(blocked, { showAll: true }), false);
});

/* ------------------------------- capabilities ------------------------------ */

test("capabilities come from UUIDs, CoD service bits and the media player", () => {
  const caps = capabilitiesOf({
    uuids: ["0000110b-0000-1000-8000-00805f9b34fb", "0000111f-0000-1000-8000-00805f9b34fb"],
    classOfDevice: 0x5a020c,
    batteryPercent: 55,
    hasMediaPlayer: true,
  });
  assert.deepEqual(caps, {
    audio: true,
    remoteControl: true,
    handsFree: true,
    battery: true,
  });
});

test("a device with no profiles reports no capabilities", () => {
  const caps = capabilitiesOf({
    uuids: [],
    classOfDevice: null,
    batteryPercent: null,
    hasMediaPlayer: false,
  });
  assert.deepEqual(caps, {
    audio: false,
    remoteControl: false,
    handsFree: false,
    battery: false,
  });
});

/* ---------------------------------- adapter -------------------------------- */

test("adapter snapshot narrows raw BlueZ properties", () => {
  const snapshot = toAdapterSnapshot("/org/bluez/hci0", {
    Alias: "renault-mmi",
    Address: "00:11:22:33:44:55",
    Powered: true,
    Discoverable: false,
    Pairable: true,
    Discovering: true,
  });
  assert.deepEqual(snapshot, {
    path: "/org/bluez/hci0",
    name: "renault-mmi",
    address: "00:11:22:33:44:55",
    powered: true,
    discoverable: false,
    pairable: true,
    discovering: true,
  });
});

test("adapter snapshot falls back to Name and tolerates missing properties", () => {
  const snapshot = toAdapterSnapshot("/org/bluez/hci0", { Name: "hci0" });
  assert.equal(snapshot.name, "hci0");
  assert.equal(snapshot.powered, false);
  assert.equal(snapshot.address, null);
});
