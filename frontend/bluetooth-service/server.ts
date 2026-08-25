import http from "node:http";
import fsp from "node:fs/promises";
import path from "node:path";
import type { BluetoothConfig } from "./config.js";
import type { BluetoothPlaybackAction, BluetoothState } from "./types.js";
import { BlueZClient } from "./bluez.js";
import { BluetoothPlayer } from "./player.js";
import { logger } from "./logger.js";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const PLAYBACK_ACTIONS = ["play", "pause", "toggle", "next", "previous", "stop"];

export interface BluetoothServer {
  server: http.Server;
  player: BluetoothPlayer;
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    ...CORS_HEADERS,
  });
  res.end(JSON.stringify(body));
}

function sendNotFound(res: http.ServerResponse): void {
  sendJson(res, 404, { error: "Not found" });
}

function readJsonBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk: Buffer) => {
      data += chunk;
    });
    req.on("end", () => {
      try {
        resolve(data ? (JSON.parse(data) as Record<string, unknown>) : {});
      } catch (error) {
        reject(error instanceof Error ? error : new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

export function createServer(
  config: BluetoothConfig,
  bluez: BlueZClient,
  player: BluetoothPlayer,
): BluetoothServer {
  const sseClients = new Set<http.ServerResponse>();

  const broadcast = (state: BluetoothState): void => {
    const payload = `data: ${JSON.stringify(state)}\n\n`;
    for (const client of sseClients) {
      client.write(payload);
    }
  };
  player.on("state", broadcast);

  const server = http.createServer(async (req, res) => {
    if (req.method === "OPTIONS") {
      res.writeHead(204, CORS_HEADERS);
      res.end();
      return;
    }

    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const parts = url.pathname.split("/").filter(Boolean);

    if (req.method !== "OPTIONS" && parts[0] !== "api") {
      logger.log(`${req.method ?? "GET"} ${url.pathname} -> 404`);
      sendNotFound(res);
      return;
    }
    if (req.method !== "OPTIONS" && parts[1] !== "events") {
      logger.log(`${req.method ?? "GET"} ${url.pathname}`);
    }

    try {
      const route = parts[1];

      switch (route) {
        case "health": {
          const state = player.getState();
          sendJson(res, 200, {
            ok: true,
            bluezAvailable: bluez.isAvailable(),
            connected: state.connected,
            playerAvailable: state.track != null,
          });
          break;
        }

        case "state":
          sendJson(res, 200, player.getState());
          break;

        case "playback": {
          if (req.method !== "POST") {
            sendJson(res, 405, { error: "POST required" });
            break;
          }
          const body = await readJsonBody(req);
          const action = typeof body.action === "string" ? body.action : "";
          if (!PLAYBACK_ACTIONS.includes(action)) {
            sendJson(res, 400, { error: "Unknown playback action" });
            break;
          }
          sendJson(res, 200, await player.runAction(action as BluetoothPlaybackAction));
          break;
        }

        case "volume": {
          if (req.method !== "POST") {
            sendJson(res, 405, { error: "POST required" });
            break;
          }
          const body = await readJsonBody(req);
          const volume = Number(body.volume);
          if (!Number.isFinite(volume)) {
            sendJson(res, 400, { error: "Invalid volume" });
            break;
          }
          await player.setVolume(volume);
          sendJson(res, 200, player.getState());
          break;
        }

        case "events":
          handleEvents(req, res);
          break;

        case "artwork": {
          if (req.method !== "GET") {
            sendJson(res, 405, { error: "GET required" });
            break;
          }
          const name = parts[2] ?? "";
          if (!/^[A-Za-z0-9_-]+\.jpg$/.test(name)) {
            sendNotFound(res);
            break;
          }
          try {
            const data = await fsp.readFile(path.join(config.artworkDir, name));
            res.writeHead(200, {
              "Content-Type": "image/jpeg",
              "Content-Length": data.length,
              "Cache-Control": "max-age=86400",
              ...CORS_HEADERS,
            });
            res.end(data);
          } catch {
            sendNotFound(res);
          }
          break;
        }

        default:
          sendNotFound(res);
          break;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      sendJson(res, 500, { error: message });
    }
  });

  server.requestTimeout = 0;

  function handleEvents(req: http.IncomingMessage, res: http.ServerResponse): void {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      ...CORS_HEADERS,
    });
    res.write(`data: ${JSON.stringify(player.getState())}\n\n`);
    sseClients.add(res);
    req.on("close", () => {
      sseClients.delete(res);
    });
  }

  return { server, player };
}
