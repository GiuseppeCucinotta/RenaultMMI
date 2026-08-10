import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

export interface JukeboxConfig {
  musicRoot: string;
  port: number;
  libraryPath: string;
  artworkCacheDir: string;
  mpvBinary: string;
}

function resolveMpvBinary(): string {
  const fromEnv = process.env.JUKEBOX_MPV_BINARY;
  if (fromEnv) return fromEnv;

  const which = spawnSync("which", ["mpv"], { encoding: "utf8" });
  if (which.status === 0 && which.stdout.trim()) {
    return which.stdout.trim();
  }
  return "/usr/bin/mpv";
}

export function resolveConfig(env: NodeJS.ProcessEnv = process.env): JukeboxConfig {
  const musicRoot = path.resolve(env.JUKEBOX_MUSIC_ROOT ?? path.join(os.homedir(), "Music"));
  const port = Number(env.JUKEBOX_PORT ?? 4100);

  return {
    musicRoot,
    port,
    libraryPath: path.join(musicRoot, "library.json"),
    artworkCacheDir: path.join(musicRoot, ".jukebox", "artwork"),
    mpvBinary: resolveMpvBinary(),
  };
}
