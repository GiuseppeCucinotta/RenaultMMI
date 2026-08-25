import http from "node:http";
import { CdService } from "./service.js";
import type { CdPlaybackAction } from "./types.js";
import {
  CORS_HEADERS,
  createSseHub,
  readJsonBody,
  sendJson,
  sendNotFound,
} from "../shared/service-http.js";

export interface CdServer {
  server: http.Server;
}

const PLAYBACK_ACTIONS: readonly CdPlaybackAction[] = [
  "play",
  "pause",
  "toggle",
  "next",
  "previous",
  "stop",
];

function isPlaybackAction(value: unknown): value is CdPlaybackAction {
  return typeof value === "string" && PLAYBACK_ACTIONS.includes(value as CdPlaybackAction);
}

export function createServer(service: CdService): CdServer {
  const sse = createSseHub<ReturnType<CdService["getState"]>>();
  service.on("state", (state: ReturnType<CdService["getState"]>) =>
    sse.broadcast(state),
  );

  const server = http.createServer(async (req, res) => {
    if (req.method === "OPTIONS") {
      res.writeHead(204, CORS_HEADERS);
      res.end();
      return;
    }

    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const parts = url.pathname.split("/").filter(Boolean);

    try {
      if (parts[0] !== "api") {
        sendNotFound(res);
        return;
      }

      const route = parts[1];
      const param = parts[2];

      switch (route) {
        case "health":
          sendJson(res, 200, {
            ok: true,
            driveConnected: service.getState().driveConnected,
            hasDisc: service.getState().hasDisc,
            mpvAvailable: service.isRunning(),
          });
          break;

        case "state":
          sendJson(res, 200, service.getState());
          break;

        case "playback": {
          if (req.method !== "POST") {
            sendJson(res, 405, { error: "POST required" });
            break;
          }
          const body = await readJsonBody(req);
          const action = body.action;
          if (!isPlaybackAction(action)) {
            sendJson(res, 400, { error: "Unknown playback action" });
            break;
          }
          await service.runAction(action);
          sendJson(res, 200, service.getState());
          break;
        }

        case "track": {
          if (req.method !== "POST") {
            sendJson(res, 405, { error: "POST required" });
            break;
          }
          const body = await readJsonBody(req);
          const trackIndex = Number(body.trackIndex);
          if (!Number.isInteger(trackIndex) || trackIndex < 1) {
            sendJson(res, 400, { error: "Invalid trackIndex" });
            break;
          }
          await service.playTrackAt(trackIndex);
          sendJson(res, 200, service.getState());
          break;
        }

        case "seek": {
          if (req.method !== "POST") {
            sendJson(res, 405, { error: "POST required" });
            break;
          }
          const body = await readJsonBody(req);
          const seconds = Number(body.seconds) || 0;
          await service.seek(seconds);
          sendJson(res, 200, service.getState());
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
          await service.setVolume(volume);
          sendJson(res, 200, service.getState());
          break;
        }

        case "events": {
          void param;
          handleEvents(req, res);
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
    sse.addClient(req, res, service.getState());
  }

  return { server };
}
