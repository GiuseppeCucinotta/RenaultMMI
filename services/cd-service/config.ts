import { spawnSync } from "node:child_process";

export interface CdConfig {
  port: number;
  device: string | null;
  mpvBinary: string;
}

function resolveMpvBinary(): string {
  const fromEnv = process.env.CD_MPV_BINARY;
  if (fromEnv) return fromEnv;

  const which = spawnSync("which", ["mpv"], { encoding: "utf8" });
  if (which.status === 0 && which.stdout.trim()) {
    return which.stdout.trim();
  }
  return "/usr/bin/mpv";
}

function resolveDevice(env: NodeJS.ProcessEnv): string | null {
  const explicit = env.CD_DEVICE?.trim();
  if (explicit) {
    // Allow bare names like "sr0" alongside full paths like "/dev/sr0".
    return explicit.startsWith("/dev/") ? explicit : `/dev/${explicit}`;
  }
  return null; // auto-detect
}

export function resolveConfig(env: NodeJS.ProcessEnv = process.env): CdConfig {
  return {
    port: Number(env.CD_PORT ?? 4300),
    device: resolveDevice(env),
    mpvBinary: resolveMpvBinary(),
  };
}
