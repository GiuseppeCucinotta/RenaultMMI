import assert from "node:assert/strict";
import { test } from "node:test";
import { createSilentLogger } from "../shared/logger.js";
import { waitFor } from "./support.js";
import { PhoneManager } from "../bluetooth-service/phone.js";
import type { AgentPort, BluezPort } from "../bluetooth-service/ports.js";
import { ArtworkService } from "../bluetooth-service/artwork.js";

/** No session bus in tests: cover art stays idle instead of leaking a socket. */
const buslessArtwork = (bluez: BluezPort, cacheDir: string): ArtworkService =>
  new ArtworkService(bluez, cacheDir, () => null);
import { device, FakeAgent, FakeBluez, player } from "./fake-bluez.js";

const PHONE = "/org/bluez/hci0/dev_60_06_E3_15_F2_B7";
const OTHER = "/org/bluez/hci0/dev_40_A2_DB_B9_7F_F7";

function harness(options: { devices?: ReturnType<typeof device>[] } = {}) {
  const bluez = new FakeBluez();
  const agent = new FakeAgent();
  bluez.devices = options.devices ?? [device({ path: PHONE, alias: "Test Phone", paired: true })];
  const manager = new PhoneManager({
    config: {
      port: 0,
      artworkDir: "/tmp/renault-mmi-test-artwork",
      showAllDevices: false,
    },
    logger: createSilentLogger(),
    bluez: bluez as unknown as BluezPort,
    agent: agent as unknown as AgentPort,
    artworkFactory: buslessArtwork,
  });
  const states: number[] = [];
  manager.on("state", () => states.push(1));
  /**
   * Every test that starts the manager must stop it: the OBEX session bus and
   * an in-flight pairing timer both keep the event loop alive.
   */
  const stop = (): Promise<void> => manager.stop();
  return { bluez, agent, manager, states, stop };
}

/* ------------------------------- state mapping ----------------------------- */

test("start exposes the adapter, the paired list and whether prompts work", async () => {
  const { manager, agent, bluez } = harness();
  await manager.start();
  await agent.register();

  const state = manager.getState();
  assert.equal(state.available, true);
  assert.equal(state.adapter.pairable, true, "the car makes itself pairable");
  assert.equal(state.adapter.discovering, false);
  assert.equal(state.devices.length, 1);
  assert.equal(state.devices[0]?.name, "Test Phone");
  assert.equal(state.devices[0]?.paired, true);
  assert.equal(state.devices[0]?.connected, false);
  assert.equal(state.calls.supported, false);
  assert.equal(state.calls.calls.length, 0);
  assert.equal(manager.canPrompt(), true);
  assert.equal(bluez.pairable, true);
  await manager.stop();
  assert.equal(agent.unregistered, true);
});

test("a connected phone with a player populates the media slice", async () => {
  const { manager, bluez, stop } = harness();
  await manager.start();
  bluez.markConnected(PHONE, player(PHONE));

  const state = manager.getState();
  assert.equal(state.media.deviceId, PHONE, "media belongs to the active phone");
  assert.equal(state.media.track?.title, "Something");
  assert.equal(state.media.status, "paused");
  assert.equal(state.devices[0]?.primary, true);
  await stop();
});

test("media is empty while no phone is connected", async () => {
  const { manager, stop } = harness();
  await manager.start();
  const state = manager.getState();
  assert.equal(state.media.deviceId, null);
  assert.equal(state.media.status, "none");
  assert.equal(state.media.track, null);
  await stop();
});

test("a disconnected phone never leaks into the media slice", async () => {
  const { manager, bluez, stop } = harness();
  await manager.start();
  bluez.markConnected(PHONE, player(PHONE));
  assert.equal(manager.getState().media.deviceId, PHONE);

  bluez.simulateDisconnection(PHONE);
  const state = manager.getState();
  assert.equal(state.media.deviceId, null);
  assert.equal(state.media.track, null);
  await stop();
});

test("BlueZ disappearing resets the phone list and the media slice", async () => {
  const { manager, bluez, stop } = harness();
  await manager.start();
  bluez.markConnected(PHONE, player(PHONE));

  bluez.available = false;
  bluez.emit("bluez-unavailable");

  const state = manager.getState();
  assert.equal(state.available, false);
  assert.equal(state.media.deviceId, null);
  assert.equal(state.devices.length, 0);
  await stop();
});

/* --------------------------------- scanning -------------------------------- */

test("starting a scan makes the car discoverable and pairable", async () => {
  const { manager, bluez, stop } = harness();
  await manager.start();

  await manager.scanAction("start");
  assert.equal(bluez.discovering, true);
  assert.equal(bluez.discoverable, true);
  assert.equal(manager.getState().discovering, true);

  await manager.scanAction("stop");
  assert.equal(bluez.discovering, false);
  assert.equal(bluez.discoverable, false);
  await stop();
});

test("scan actions validate their action name", async () => {
  const { manager, stop } = harness();
  await manager.start();
  await assert.rejects(() => manager.scanAction("explode"), /Unknown scan action/);
  await stop();
});

test("refresh asks BlueZ for a resync instead of scanning", async () => {
  const { manager, bluez, stop } = harness();
  await manager.start();
  await manager.scanAction("refresh");
  assert.equal(bluez.resyncs, 1);
  assert.equal(bluez.discovering, false);
  await stop();
});

/* ------------------------------ phone actions ------------------------------ */

test("connecting an unpaired phone starts pairing and trusts it after", async () => {
  const { manager, bluez, stop } = harness({
    devices: [device({ path: PHONE, paired: false, alias: "New Phone" })],
  });
  await manager.start();

  await manager.phoneAction("connect", PHONE);

  assert.deepEqual(bluez.pairCalls, [PHONE]);
  assert.deepEqual(bluez.trustedCalls, [{ path: PHONE, trusted: true }]);
  assert.equal(manager.getState().devices[0]?.paired, true);
  assert.equal(manager.getState().devices[0]?.connected, true);
  await stop();
});

test("connecting an already-paired phone only connects its profiles", async () => {
  const { manager, bluez, stop } = harness({ devices: [device({ path: PHONE, paired: true })] });
  await manager.start();

  await manager.phoneAction("connect", PHONE);
  assert.deepEqual(bluez.pairCalls, [], "no re-pairing");
  assert.deepEqual(bluez.connectedCalls, [PHONE]);
  await stop();
});

test("untrust and forget reach BlueZ", async () => {
  const { manager, bluez, stop } = harness({ devices: [device({ path: PHONE, paired: true })] });
  await manager.start();

  await manager.phoneAction("untrust", PHONE);
  assert.deepEqual(bluez.trustedCalls[bluez.trustedCalls.length - 1], { path: PHONE, trusted: false });

  await manager.phoneAction("forget", PHONE);
  assert.deepEqual(bluez.forgotten, [PHONE]);
  assert.equal(manager.getState().devices.length, 0);
  await stop();
});

test("phone actions reject unknown actions and unknown devices", async () => {
  const { manager, stop } = harness();
  await manager.start();
  await assert.rejects(() => manager.phoneAction("levitate", PHONE), /Unknown phone action/);
  await assert.rejects(
    () => manager.phoneAction("connect", "/org/bluez/hci0/dev_00_00_00_00_00_00"),
    /Unknown device/,
  );
  await stop();
});

/* --------------------------- one phone at a time --------------------------- */

test("the last connected phone wins and the previous one is disconnected", async () => {
  const { manager, bluez, stop } = harness({
    devices: [
      device({ path: PHONE, alias: "First Phone", paired: true, connected: true }),
      device({ path: OTHER, alias: "Second Phone", paired: true }),
    ],
  });
  await manager.start();
  assert.equal(manager.getState().media.deviceId, PHONE, "the first phone is primary");

  // The second phone connects: it must take over and the first must be dropped.
  bluez.markConnected(OTHER, player(OTHER));
  // The takeover disconnects the previous phone asynchronously.
  await waitFor(() => manager.getState().media.deviceId === OTHER);

  const state = manager.getState();
  const second = state.devices.find((candidate) => candidate.id === OTHER);
  const first = state.devices.find((candidate) => candidate.id === PHONE);
  assert.equal(second?.primary, true, "the newcomer becomes primary");
  assert.equal(first?.connected, false, "the previous phone is disconnected");
  assert.equal(state.media.deviceId, OTHER, "media follows the primary phone");
  await stop();
});

/* --------------------------------- pairing --------------------------------- */

test("pairing a phone publishes a confirmation prompt with the code", async () => {
  const { manager, agent, stop } = harness({
    devices: [device({ path: PHONE, alias: "Prompted Phone" })],
  });
  await manager.start();
  await agent.register();

  agent.raisePrompt("confirmation", PHONE, "4321");
  const pairing = manager.getState().pairing;
  assert.equal(pairing.stage, "awaiting-confirmation");
  assert.equal(pairing.deviceId, PHONE);
  assert.equal(pairing.deviceName, "Prompted Phone", "the prompt names the phone");
  assert.equal(pairing.method, "confirm");
  assert.equal(pairing.passkey, "4321");

  await manager.pairingAction("confirm", PHONE);
  assert.deepEqual(agent.confirms, [true]);
  await stop();
});

test("rejecting a prompt answers BlueZ with a rejection", async () => {
  const { manager, agent, stop } = harness({ devices: [device({ path: PHONE })] });
  await manager.start();
  await agent.register();

  agent.raisePrompt("confirmation", PHONE);
  await manager.pairingAction("reject", PHONE);
  assert.equal(agent.rejections, 1);
  await stop();
});

test("a passkey prompt accepts the digits typed on the car screen", async () => {
  const { manager, agent, stop } = harness({ devices: [device({ path: PHONE })] });
  await manager.start();
  await agent.register();

  agent.raisePrompt("passkey", PHONE);
  assert.equal(manager.getState().pairing.method, "passkey-entry");

  await manager.pairingAction("submit", PHONE, "006789");
  assert.deepEqual(agent.passkeys, ["006789"]);
  await stop();
});

test("confirming updates the published state over SSE as well", async () => {
  const { manager, agent, stop } = harness({ devices: [device({ path: PHONE })] });
  await manager.start();
  await agent.register();

  const stages: string[] = [];
  manager.on("state", (state: { pairing: { stage: string } }) => stages.push(state.pairing.stage));

  agent.raisePrompt("confirmation", PHONE, "481923");
  await manager.pairingAction("confirm", PHONE);

  assert.ok(
    stages.includes("pairing"),
    `the state stream must leave awaiting-confirmation (saw: ${stages.join(", ")})`,
  );
  await stop();
});

test("rejecting the prompt also clears it from the state", async () => {
  const { manager, agent, stop } = harness({ devices: [device({ path: PHONE })] });
  await manager.start();
  await agent.register();

  agent.raisePrompt("confirmation", PHONE, "481923");
  await manager.pairingAction("reject", PHONE);

  assert.notEqual(manager.getState().pairing.stage, "awaiting-confirmation");
  assert.equal(agent.rejections, 1);
  await stop();
});

test("a phone that connects on its own dismisses a lingering prompt", async () => {
  const { manager, agent, bluez, stop } = harness({ devices: [device({ path: PHONE })] });
  await manager.start();
  await agent.register();

  agent.raisePrompt("passkey", PHONE);
  assert.equal(manager.getState().pairing.method, "passkey-entry");

  // The user taps "Pair" on the handset: it connects without the car answering.
  bluez.markConnected(PHONE);

  assert.notEqual(
    manager.getState().pairing.stage,
    "awaiting-confirmation",
    "a connected phone must not leave the modal up",
  );
  await stop();
});

test("answering with code digits dismisses the prompt too", async () => {
  const { manager, agent, stop } = harness({ devices: [device({ path: PHONE })] });
  await manager.start();
  await agent.register();

  agent.raisePrompt("passkey", PHONE);
  await manager.pairingAction("submit", PHONE, "654321");

  assert.notEqual(manager.getState().pairing.stage, "awaiting-confirmation");
  assert.deepEqual(agent.passkeys, ["654321"]);
  await stop();
});

test("an out-of-range pairing code is ignored, not sent to BlueZ", async () => {
  const { manager, agent, stop } = harness({ devices: [device({ path: PHONE })] });
  await manager.start();
  await agent.register();

  agent.raisePrompt("passkey", PHONE);
  await manager.pairingAction("submit", PHONE, "12");
  assert.deepEqual(agent.passkeys, [], "too short to be a real code");
  await stop();
});

test("pairing an unknown device fails with a reason instead of hanging", async () => {
  const { manager, stop } = harness();
  await manager.start();

  const pairing = await manager.pairingAction(
    "pair",
    "/org/bluez/hci0/dev_00_00_00_00_00_00",
  );
  assert.equal(pairing.stage, "failed");
  assert.equal(pairing.error, "unknown-device");
  await stop();
});

test("pairing failures map to the reason the UI shows", async (t) => {
  const cases: { name: string; error: string; expected: string }[] = [
    {
      name: "user rejects on the phone",
      error: "org.bluez.Error.AuthenticationRejected",
      expected: "rejected",
    },
    {
      name: "wrong PIN typed on the phone",
      error: "org.bluez.Error.AuthenticationFailed",
      expected: "failed",
    },
    {
      name: "the phone never answers",
      error: "org.bluez.Error.AuthenticationTimeout",
      expected: "timeout",
    },
    {
      name: "the adapter is not ready",
      error: "org.bluez.Error.NotReady",
      expected: "unavailable",
    },
  ];

  for (const scenario of cases) {
    await t.test(scenario.name, async () => {
      const { manager, bluez, stop } = harness({ devices: [device({ path: PHONE })] });
      bluez.failWith = Object.assign(new Error(scenario.error.split(".").pop()), {
        type: scenario.error,
      });
      await manager.start();

      await manager.pairingAction("pair", PHONE);
      const pairing = manager.getState().pairing;
      assert.equal(pairing.stage, "failed");
      assert.equal(pairing.error, scenario.expected);
      await stop();
    });
  }
});

test("a pairing action name is validated", async () => {
  const { manager, stop } = harness();
  await manager.start();
  await assert.rejects(() => manager.pairingAction("summon"), /unknown pairing action/);
  await stop();
});

/* ---------------------------------- calls ---------------------------------- */

test("call actions report that calling is not implemented yet", async () => {
  const { manager, stop } = harness();
  await manager.start();
  await assert.rejects(
    () => manager.callAction({ action: "dial", number: "123" }),
    /not available on this system yet/,
  );
  assert.equal(manager.getState().calls.supported, false);
  await stop();
});

/* --------------------------------- health ---------------------------------- */

test("health details describe the phone, not the mpv side", async () => {
  const { manager, bluez, stop } = harness();
  await manager.start();
  bluez.markConnected(PHONE, player(PHONE));

  const health = manager.healthDetails();
  assert.equal(health.bluezAvailable, true);
  assert.equal(health.connected, true);
  assert.equal(health.adapterPowered, true);
  assert.equal(health.pairedDevices, 1);
  assert.equal(health.visibleDevices, 1);
  assert.equal(health.pairingStage, "idle");
  assert.equal(health.callsSupported, false);
  await stop();
});

test("health reports that prompts are unavailable when the agent is not registered", async () => {
  const { manager, stop } = harness();
  await manager.start();
  assert.equal(manager.canPrompt(), false);
  assert.equal(manager.healthDetails().pairingPrompt, false);
  await stop();
});
