import http from "node:http";
import { createReadStream, existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import type { JukeboxConfig } from "./config.js";
import {
  findAlbum,
  resolveMusicPath,
  type JukeboxLibrary,
  type JukeboxPlaybackState,
} from "./library.js";
import { JukeboxPlayer } from "./player.js";
import { loadLibrary, saveLibrary, scanLibrary } from "./scanner.js";

const MIME_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export interface JukeboxServer {
  server: http.Server;
  player: JukeboxPlayer;
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

export async function createServer(config: JukeboxConfig): Promise<JukeboxServer> {
  let library = await loadLibrary(config.libraryPath);
  const player = new JukeboxPlayer(config.musicRoot, config.mpvBinary);
  player.setLibrary(library);

  const sseClients = new Set<http.ServerResponse>();

  const broadcast = (state: JukeboxPlaybackState): void => {
    const payload = `data: ${JSON.stringify(state)}\n\n`;
    for (const client of sseClients) {
      client.write(payload);
    }
  };
  player.on("state", broadcast);

  const requestScan = async (): Promise<JukeboxLibrary> => {
    library = await scanLibrary(config.musicRoot, config.artworkCacheDir);
    await saveLibrary(config.libraryPath, library);
    player.setLibrary(library);
    return library;
  };

  player.start().catch((error: unknown) => {
    console.error("[jukebox] failed to start mpv:", error instanceof Error ? error.message : error);
  });

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
            libraryLoaded: library !== null,
            mpvAvailable: player.isRunning(),
          });
          break;

        case "library":
          if (!library) sendJson(res, 404, { error: "Library not scanned yet" });
          else sendJson(res, 200, library);
          break;

        case "scan":
          if (req.method !== "POST") {
            sendJson(res, 405, { error: "POST required" });
            break;
          }
          sendJson(res, 200, await requestScan());
          break;

        case "play": {
          if (req.method !== "POST") {
            sendJson(res, 405, { error: "POST required" });
            break;
          }
          const body = await readJsonBody(req);
          const albumId = typeof body.albumId === "string" ? body.albumId : "";
          await player.playAlbum(albumId);
          sendJson(res, 200, player.getState());
          break;
        }

        case "playback": {
          if (req.method !== "POST") {
            sendJson(res, 405, { error: "POST required" });
            break;
          }
          const body = await readJsonBody(req);
          const action = typeof body.action === "string" ? body.action : "";
          switch (action) {
            case "play":
              await player.resume();
              break;
            case "pause":
              await player.pause();
              break;
            case "toggle":
              await player.togglePause();
              break;
            case "next":
              await player.next();
              break;
            case "previous":
              await player.previous();
              break;
            case "stop":
              await player.stop();
              break;
            default:
              sendJson(res, 400, { error: "Unknown playback action" });
              break;
          }
          sendJson(res, 200, player.getState());
          break;
        }

        case "seek": {
          if (req.method !== "POST") {
            sendJson(res, 405, { error: "POST required" });
            break;
          }
          const body = await readJsonBody(req);
          const seconds = Number(body.seconds) || 0;
          await player.seek(seconds);
          sendJson(res, 200, player.getState());
          break;
        }

        case "track": {
          if (req.method !== "POST") {
            sendJson(res, 405, { error: "POST required" });
            break;
          }
          const body = await readJsonBody(req);
          const trackIndex = Number(body.trackIndex);
          if (!Number.isInteger(trackIndex) || trackIndex < 0) {
            sendJson(res, 400, { error: "Invalid trackIndex" });
            break;
          }
          await player.playTrackAt(trackIndex);
          sendJson(res, 200, player.getState());
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

        case "state":
          sendJson(res, 200, player.getState());
          break;

        case "artwork":
          await handleArtwork(res, param);
          break;

        case "events":
          handleEvents(req, res);
          break;

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

  async function handleArtwork(res: http.ServerResponse, albumId?: string): Promise<void> {
    const album = albumId && library ? findAlbum(library, albumId) : null;
    const relativePath = album?.artworkPath;
    if (!albumId || !relativePath) {
      sendNotFound(res);
      return;
    }

    const absolutePath = resolveMusicPath(config.musicRoot, relativePath);
    if (!existsSync(absolutePath)) {
      sendNotFound(res);
      return;
    }

    const stat = await fs.stat(absolutePath);
    const ext = path.extname(absolutePath).toLowerCase();
    res.writeHead(200, {
      "Content-Type": MIME_TYPES[ext] ?? "application/octet-stream",
      "Content-Length": stat.size,
      "Cache-Control": "no-cache",
      ...CORS_HEADERS,
    });
    createReadStream(absolutePath).pipe(res);
  }

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
