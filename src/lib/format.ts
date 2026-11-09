import type { AppSettings, VideoAsset } from "../types";

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 KB";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = unit === 0 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(digits).replace(/\.0+$/, "")} ${units[unit]}`;
}

export function formatDuration(seconds: number, tenths = false): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  // Work in whole tenths so binary floating-point error cannot round 4.8 down to 4.7.
  const totalTenths = Math.round(seconds * 10);
  const whole = Math.floor(totalTenths / 10);
  const tenth = totalTenths % 10;
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const secs = whole % 60;
  const suffix = tenths ? `.${tenth}` : "";

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}${suffix}`;
  }
  return `${minutes}:${String(secs).padStart(2, "0")}${suffix}`;
}

export function formatFps(fps: number): string {
  if (!Number.isFinite(fps) || fps <= 0) return "—";
  return Number.isInteger(fps) ? String(fps) : fps.toFixed(1).replace(/\.0$/, "");
}

export function formatDimensions(width: number, height: number): string {
  return `${Math.round(width)} × ${Math.round(height)}`;
}

export function outputDimensions(
  video: VideoAsset | null,
  settings: AppSettings,
): { width: number; height: number } | null {
  if (!video) return null;
  const sourceWidth = Math.max(2, video.width);
  const sourceHeight = Math.max(2, video.height);
  const desired = settings.width === 0 ? sourceWidth : settings.width;
  const width = Math.max(2, Math.min(desired, sourceWidth, 1600));
  const height = Math.max(2, Math.round((width * sourceHeight) / sourceWidth));
  return { width, height };
}

export function outputDuration(trim: { start: number; end: number }, boomerang: boolean): number {
  return Math.max(0, trim.end - trim.start) * (boomerang ? 2 : 1);
}

export function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function readError(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object") {
    const maybe = error as { message?: unknown };
    if (typeof maybe.message === "string") return maybe.message;
    try {
      return JSON.stringify(error);
    } catch {
      return String(error);
    }
  }
  return String(error ?? "Something went wrong.");
}

export function conciseError(error: unknown): string {
  const message = readError(error).replace(/^Error:\s*/i, "").trim();
  if (message.length <= 260) return message;
  return `${message.slice(0, 257).trimEnd()}…`;
}

export function compactPath(path: string): string {
  const parts = path.split("/").filter(Boolean);
  if (parts.length <= 3) return path;
  return `…/${parts.slice(-2).join("/")}`;
}

export function fileNameFromPath(path: string): string {
  return path.split("/").pop() || path;
}
