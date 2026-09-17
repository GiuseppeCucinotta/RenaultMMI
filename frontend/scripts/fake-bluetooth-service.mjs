/**
 * Tiny fake Bluetooth service for UI previews: serves a connected-phone state
 * (plus its SSE stream) so a view can be eyeballed without BlueZ or a phone.
 *
 * Dev-only helper. Run it on a spare port and point the renderer at it with
 * `VITE_BLUETOOTH_BASE_URL=http://127.0.0.1:<port>`.
 *
 *   node scripts/fake-bluetooth-service.mjs 4201
 */
import http from "node:http";

const port = Number(process.argv[2] ?? 4201);
const now = Date.now();

const state = {
  available: true,
  adapter: {
    path: "/org/bluez/hci0",
    name: "renault-mmi",
    address: "00:1A:7D:DA:71:15",
    powered: true,
    discoverable: false,
    pairable: true,
    discovering: false,
  },
  discovering: false,
  devices: [
    {
      id: "/org/bluez/hci0/dev_60_06_E3_15_F2_B7",
      address: "60:06:E3:15:F2:B7",
      name: "Giuseppe's iPhone 15 Pro",
      kind: "phone",
      paired: true,
      // Start disconnected (NOPHONE=1) to preview the connect screen.
      connected: process.env.NOPHONE !== "1",
      trusted: true,
      primary: process.env.NOPHONE !== "1",
      rssi: -48,
      batteryPercent: 72,
      capabilities: { audio: true, remoteControl: true, handsFree: true, battery: true },
    },
    {
      id: "/org/bluez/hci0/dev_40_A2_DB_B9_7F_F7",
      address: "40:A2:DB:B9:7F:F7",
      name: "Pixel 9 Pro XL",
      kind: "phone",
      paired: false,
      connected: false,
      trusted: false,
      primary: false,
      rssi: -63,
      batteryPercent: null,
      capabilities: { audio: true, remoteControl: true, handsFree: true, battery: false },
    },
  ],
  pairing: {
    stage: "idle",
    deviceId: null,
    deviceName: null,
    method: null,
    passkey: null,
    error: null,
  },
  media: {
    deviceId: process.env.NOPHONE === "1" ? null : "/org/bluez/hci0/dev_60_06_E3_15_F2_B7",
    status: "playing",
    track: {
      title: "Big Poppa",
      artist: "The Notorious B.I.G.",
      album: "Ready to Die",
      durationMs: 254000,
      artworkUrl: null,
      artworkState: "none",
    },
    positionMs: 62000,
    durationMs: 254000,
  },
  calls: { supported: false, activeCallId: null, calls: [], recentNumbers: [] },
};

const clients = new Set();

/** Never let one dead preview socket take the whole fake service down. */
function broadcast() {
  const payload = `data: ${JSON.stringify(state)}\n\n`;
  for (const client of [...clients]) {
    try {
      if (client.destroyed || client.writableEnded) {
        clients.delete(client);
        continue;
      }
      client.write(payload);
    } catch {
      clients.delete(client);
    }
  }
}

function readBody(req) {
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => resolve(raw));
  });
}

/** Handles a parsed request; `body` is the decoded JSON for POSTs. */
function handle(req, res, body) {
  if (process.env.LOG_REQUESTS === "1") {
    console.log(`[fake] ${req.method} ${req.url} ${body ? JSON.stringify(body) : ""}`);
  }
  const respond = (payload) => {
    if (res.headersSent || res.writableEnded) {
      console.warn(`[fake] ignored a second response for ${req.method} ${req.url}`);
      return;
    }
    const text = JSON.stringify(payload);
    res.writeHead(200, {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(text),
      "Access-Control-Allow-Origin": "*",
    });
    res.end(text);
  };

  if (req.url?.startsWith("/api/health")) {
    respond({ ok: true, service: "bluetooth", phase: "running", ...state.adapter });
    return;
  }

  if (req.url?.startsWith("/api/events")) {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Access-Control-Allow-Origin": "*",
      Connection: "keep-alive",
    });
    res.write(`data: ${JSON.stringify(state)}\n\n`);
    clients.add(res);
    res.on("error", () => clients.delete(res));
    req.on("close", () => clients.delete(res));
    return;
  }

  if (req.url?.startsWith("/api/phone")) {
    // Mirror the real service: connecting an unpaired phone starts pairing,
    // and the blocked prompt shows up in the returned state.
    const target = state.devices.find((d) => d.id === body?.deviceId);
    if (body?.action === "connect" && target && !target.paired) {
      state.pairing = {
        stage: "awaiting-confirmation",
        deviceId: target.id,
        deviceName: target.name,
        method: "confirm",
        passkey: "481923",
        error: null,
      };
    }
    respond(state);
    return;
  }

  if (req.url?.startsWith("/api/pairing")) {
    // Simulate BlueZ raising a numeric-comparison prompt, then its answer.
    if (body?.action === "pair") {
      state.pairing = {
        stage: "awaiting-confirmation",
        deviceId: state.devices[1].id,
        deviceName: state.devices[1].name,
        method: "confirm",
        passkey: "481923",
        error: null,
      };
    } else {
      const target = state.pairing.deviceId;
      // The prompt was answered: pairing is now running and takes a moment.
      state.pairing = { ...state.pairing, stage: "pairing", passkey: null };
      setTimeout(() => {
        const device = state.devices.find((d) => d.id === target);
        if (device) {
          device.paired = true;
          device.connected = true;
          device.primary = true;
        }
        state.pairing = {
          stage: "idle",
          deviceId: null,
          deviceName: null,
          method: null,
          passkey: null,
          error: null,
        };
        broadcast();
      }, Number(process.env.PAIR_DELAY_MS ?? 3000));
    }
    respond(state.pairing);
    return;
  }

  // Mutations echo the state back; this preview only needs rendering.
  respond(state);
}

const server = http.createServer(async (req, res) => {
  const raw = await readBody(req);
  let body = null;
  try {
    body = raw ? JSON.parse(raw) : null;
  } catch {
    body = null;
  }
  handle(req, res, body);
});

server.listen(port, "127.0.0.1", () => {
  console.log(`fake bluetooth service on http://127.0.0.1:${port} (uptime base ${now})`);
});
