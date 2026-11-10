import { convertFileSrc, invoke, isTauri } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open } from "@tauri-apps/plugin-dialog";
import type {
  AppSettings,
  ExportProgress,
  ExportRequest,
  ExportResult,
  ImportOutcome,
  ToolsStatus,
} from "../types";
import { DEFAULT_SETTINGS, GIF_FILTER, VIDEO_FILTER } from "../types";

export const desktop = isTauri();

export async function loadSettings(): Promise<AppSettings> {
  if (!desktop) return DEFAULT_SETTINGS;
  return invoke<AppSettings>("load_settings");
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  if (!desktop) return;
  await invoke("save_settings", { settings });
}

export async function checkTools(): Promise<ToolsStatus> {
  if (!desktop) {
    return {
      available: false,
      version: null,
      ffmpegPath: null,
      ffprobePath: null,
      error: "Open Gifsmith as a desktop app to use video tools.",
    };
  }
  return invoke<ToolsStatus>("check_tools");
}

export async function importMedia(paths: string[]): Promise<ImportOutcome> {
  if (!desktop) {
    return { videos: [], errors: ["Imports are only available in the desktop app."] };
  }
  return invoke<ImportOutcome>("import_media", { paths });
}

export async function importGifs(paths: string[]): Promise<ImportOutcome> {
  if (!desktop) {
    return { videos: [], errors: ["Imports are only available in the desktop app."] };
  }
  return invoke<ImportOutcome>("import_gifs", { paths });
}

export async function chooseVideos(): Promise<string[]> {
  if (!desktop) return [];
  const result = await open({
    title: "Import videos",
    buttonLabel: "Import",
    multiple: true,
    directory: false,
    filters: [VIDEO_FILTER],
  });
  if (result === null) return [];
  return Array.isArray(result) ? result : [result];
}

export async function chooseGifs(): Promise<string[]> {
  if (!desktop) return [];
  const result = await open({
    title: "Import GIFs",
    buttonLabel: "Import",
    multiple: true,
    directory: false,
    filters: [GIF_FILTER],
  });
  if (result === null) return [];
  return Array.isArray(result) ? result : [result];
}

export async function chooseFolder(): Promise<string | null> {
  if (!desktop) return null;
  const result = await open({
    title: "Import a folder of videos",
    buttonLabel: "Import folder",
    multiple: false,
    directory: true,
  });
  return typeof result === "string" ? result : null;
}

export async function chooseOutputFolder(current: string | null): Promise<string | null> {
  if (!desktop) return null;
  const result = await open({
    title: "Choose where GIFs are saved",
    buttonLabel: "Choose folder",
    multiple: false,
    directory: true,
    defaultPath: current ?? undefined,
  });
  return typeof result === "string" ? result : null;
}

export async function exportGif(request: ExportRequest): Promise<ExportResult> {
  return invoke<ExportResult>("export_gif", { request });
}

export async function cancelExport(): Promise<void> {
  await invoke("cancel_export");
}

export async function revealInFinder(path: string): Promise<void> {
  await invoke("reveal_in_finder", { path });
}

export async function openFile(path: string): Promise<void> {
  await invoke("open_file", { path });
}

export function assetUrl(path: string): string {
  if (!desktop) return path;
  return convertFileSrc(path);
}

export async function listenForExportProgress(
  handler: (progress: ExportProgress) => void,
): Promise<UnlistenFn> {
  if (!desktop) return () => {};
  return listen<ExportProgress>("export-progress", (event) => handler(event.payload));
}

export async function listenForDrops(
  onPaths: (paths: string[]) => void,
  onActiveChange: (active: boolean) => void,
): Promise<UnlistenFn> {
  if (!desktop) return () => {};
  return getCurrentWebview().onDragDropEvent((event) => {
    switch (event.payload.type) {
      case "enter":
      case "over":
        onActiveChange(true);
        break;
      case "leave":
        onActiveChange(false);
        break;
      case "drop":
        onActiveChange(false);
        if (event.payload.paths.length > 0) {
          onPaths(event.payload.paths);
        }
        break;
    }
  });
}
