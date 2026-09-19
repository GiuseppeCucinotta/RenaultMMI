import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { JukeboxLibrary } from "../shared/jukebox-types.js";
import { createSilentLogger } from "../shared/logger.js";
import type { JukeboxConfig } from "../jukebox-service/config.js";
import { JukeboxService } from "../jukebox-service/service.js";
import { createFakeMpvFactory, type FakeMpvFactory } from "./fake-mpv.js";

/**
 * Shared jukebox fixture.
 *
 * Lives on its own so both the jukebox suspend/resume suite (services) and the
 * entertainment-volume integration suite (frontend, which drives the jukebox
 * through the Electron controller) spin up the exact same service shape.
 */
export const MUSIC_ROOT = "/music";
export const ALBUM_ID = "al_test";
export const TRACK_FILES = ["01-one.mp3", "02-two.mp3", "03-three.mp3"];

export function makeLibrary(): JukeboxLibrary {
  return {
    schemaVersion: 2,
    generatedAt: new Date(0).toISOString(),
    musicRoot: MUSIC_ROOT,
    artists: [
      {
        id: "ar_test",
        name: "Test Artist",
        albums: [
          {
            id: ALBUM_ID,
            title: "Test Album",
            artistName: "Test Artist",
            year: 2024,
            artworkPath: null,
            songs: TRACK_FILES.map((filePath, index) => ({
              id: `${ALBUM_ID}_${index + 1}`,
              title: `Track ${index + 1}`,
              track: index + 1,
              durationSeconds: 180 + index,
              format: "mp3",
              filePath,
            })),
          },
        ],
      },
    ],
  };
}

export interface SuspendedBody {
  suspended: boolean;
  phase: string;
}

export interface JukeboxHealthBody {
  suspended: boolean;
  phase: string;
  libraryLoaded: boolean;
  mpvAvailable: boolean;
}

export interface JukeboxContext {
  service: JukeboxService;
  base: string;
  mpvFactory: FakeMpvFactory;
}

export async function withJukeboxService(
  run: (ctx: JukeboxContext) => Promise<void>,
  settings?: { autoSuspend: boolean; idleTimeoutMs: number },
): Promise<void> {
  const dir = mkdtempSync(path.join(tmpdir(), "jukebox-test-"));
  const config: JukeboxConfig = {
    musicRoot: dir,
    port: 0,
    libraryPath: path.join(dir, "library.json"),
    artworkCacheDir: path.join(dir, ".jukebox", "artwork"),
    mpvBinary: "/usr/bin/mpv",
  };
  writeFileSync(config.libraryPath, JSON.stringify(makeLibrary()), "utf8");

  const mpvFactory = createFakeMpvFactory();
  const service = new JukeboxService(config, {
    logger: createSilentLogger(),
    createMpv: mpvFactory.createMpv,
    settings: settings ?? { autoSuspend: false },
    installProcessHandlers: false,
  });

  await service.start();
  try {
    await run({ service, base: `http://127.0.0.1:${service.port}`, mpvFactory });
  } finally {
    await service.stop();
    rmSync(dir, { recursive: true, force: true });
  }
}
