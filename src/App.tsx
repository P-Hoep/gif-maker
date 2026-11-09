import { Download } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { UnlistenFn } from "@tauri-apps/api/event";
import type {
  ActiveJob,
  AppSettings,
  ExportResult,
  PreviewMode,
  SaveState,
  ToastItem,
  ToastKind,
  ToolsStatus,
  TrimRange,
  VideoAsset,
} from "./types";
import { DEFAULT_SETTINGS } from "./types";
import {
  cancelExport,
  checkTools,
  chooseFolder,
  chooseOutputFolder,
  chooseVideos,
  exportGif,
  importMedia,
  listenForDrops,
  listenForExportProgress,
  loadSettings,
  openFile,
  revealInFinder,
  saveSettings,
} from "./lib/api";
import {
  clamp,
  conciseError,
  formatBytes,
  readError,
} from "./lib/format";
import { TitleBar } from "./components/TitleBar";
import { Sidebar } from "./components/Sidebar";
import { Preview } from "./components/Preview";
import { Inspector } from "./components/Inspector";
import { ToastStack } from "./components/Toasts";

const EXPORT_CANCELLED = "EXPORT_CANCELLED";
const MIN_TRIM = 0.1;

const VISUAL_SETTING_KEYS = new Set<keyof AppSettings>([
  "playback",
  "width",
  "fps",
  "colors",
  "dither",
  "loopForever",
  "optimize",
  "titleText",
  "creditText",
  "titlePosition",
  "textStyle",
  "typeface",
  "textScale",
]);

function makeId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `gifsmith-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function normalizeSettings(input: AppSettings): AppSettings {
  const merged = { ...DEFAULT_SETTINGS, ...input };
  return {
    ...merged,
    playback: ["forward", "reverse", "boomerang"].includes(merged.playback)
      ? merged.playback
      : DEFAULT_SETTINGS.playback,
    dither: ["sierra", "bayer", "none"].includes(merged.dither)
      ? merged.dither
      : DEFAULT_SETTINGS.dither,
    titlePosition: ["top", "bottom"].includes(merged.titlePosition)
      ? merged.titlePosition
      : DEFAULT_SETTINGS.titlePosition,
    textStyle: ["shadow", "scrim"].includes(merged.textStyle)
      ? merged.textStyle
      : DEFAULT_SETTINGS.textStyle,
    typeface: ["sans", "serif"].includes(merged.typeface)
      ? merged.typeface
      : DEFAULT_SETTINGS.typeface,
    width: Number.isFinite(merged.width)
      ? clamp(Math.round(merged.width), 0, 1600)
      : DEFAULT_SETTINGS.width,
    fps: Number.isFinite(merged.fps)
      ? clamp(Math.round(merged.fps), 5, 30)
      : DEFAULT_SETTINGS.fps,
    colors: Number.isFinite(merged.colors)
      ? clamp(Math.round(merged.colors), 8, 256)
      : DEFAULT_SETTINGS.colors,
    textScale: Number.isFinite(merged.textScale)
      ? clamp(Math.round(merged.textScale), 50, 160)
      : DEFAULT_SETTINGS.textScale,
    titleText: (merged.titleText ?? "").slice(0, 160),
    creditText: (merged.creditText ?? "").slice(0, 160),
    outputDir: typeof merged.outputDir === "string" && merged.outputDir ? merged.outputDir : null,
    loopForever: Boolean(merged.loopForever),
    optimize: Boolean(merged.optimize),
  };
}

function importErrorDetail(errors: string[]): string {
  const first = conciseError(errors[0]);
  if (errors.length <= 1) return first;
  return `${first} (+${errors.length - 1} more)`;
}

export default function App() {
  const [videos, setVideos] = useState<VideoAsset[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [trims, setTrims] = useState<Record<string, TrimRange>>({});
  const [results, setResults] = useState<Record<string, ExportResult>>({});
  const [previewMode, setPreviewMode] = useState<PreviewMode>("source");
  const [importing, setImporting] = useState(false);
  const [dropActive, setDropActive] = useState(false);
  const [tools, setTools] = useState<ToolsStatus | null>(null);
  const [checkingTools, setCheckingTools] = useState(true);
  const [job, setJob] = useState<ActiveJob | null>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const importingRef = useRef(false);
  const activeJobRef = useRef<string | null>(null);
  const videosRef = useRef(videos);
  videosRef.current = videos;
  const toastTimers = useRef<Map<string, number>>(new Map());
  const saveTimerRef = useRef<number | null>(null);
  const skipInitialSave = useRef(true);
  const saveErrorShown = useRef(false);

  const selectedVideo = useMemo(
    () => videos.find((video) => video.path === selectedPath) ?? null,
    [videos, selectedPath],
  );

  const trim = useMemo<TrimRange | null>(() => {
    if (!selectedVideo) return null;
    return trims[selectedVideo.path] ?? { start: 0, end: selectedVideo.duration };
  }, [selectedVideo, trims]);

  const result = selectedVideo ? (results[selectedVideo.path] ?? null) : null;

  const dismissToast = useCallback((id: string) => {
    const timer = toastTimers.current.get(id);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      toastTimers.current.delete(id);
    }
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const addToast = useCallback(
    (toast: Omit<ToastItem, "id">, duration?: number) => {
      const id = makeId();
      const kind: ToastKind = toast.kind;
      const item: ToastItem = { ...toast, id };
      setToasts((current) => [...current.slice(-3), item]);
      const timeout =
        duration ?? (kind === "error" ? 7000 : kind === "success" ? 5000 : 4200);
      const timer = window.setTimeout(() => dismissToast(id), timeout);
      toastTimers.current.set(id, timer);
    },
    [dismissToast],
  );

  useEffect(() => {
    return () => {
      toastTimers.current.forEach((timer) => window.clearTimeout(timer));
      toastTimers.current.clear();
      if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const loaded = await loadSettings();
        if (!cancelled) setSettings(normalizeSettings(loaded));
      } catch (error) {
        if (!cancelled) {
          addToast({
            kind: "error",
            title: "Couldn’t load your saved settings",
            detail: conciseError(error),
          });
        }
      } finally {
        if (!cancelled) setSettingsLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [addToast]);

  useEffect(() => {
    if (!settingsLoaded) return;
    if (skipInitialSave.current) {
      skipInitialSave.current = false;
      return;
    }

    setSaveState("saving");
    let active = true;
    const timer = window.setTimeout(() => {
      void saveSettings(settings)
        .then(() => {
          if (!active) return;
          saveErrorShown.current = false;
          setSaveState("saved");
          if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
          saveTimerRef.current = window.setTimeout(() => {
            setSaveState((current) => (current === "saved" ? "idle" : current));
          }, 1800);
        })
        .catch((error) => {
          if (!active) return;
          setSaveState("error");
          if (!saveErrorShown.current) {
            saveErrorShown.current = true;
            addToast({
              kind: "error",
              title: "Settings couldn’t be saved",
              detail: conciseError(error),
            });
          }
        });
    }, 400);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [settings, settingsLoaded, addToast]);

  const runToolCheck = useCallback(async (): Promise<ToolsStatus | null> => {
    setCheckingTools(true);
    try {
      const status = await checkTools();
      setTools(status);
      return status;
    } catch (error) {
      const fallback: ToolsStatus = {
        available: false,
        version: null,
        ffmpegPath: null,
        ffprobePath: null,
        error: readError(error),
      };
      setTools(fallback);
      return fallback;
    } finally {
      setCheckingTools(false);
    }
  }, []);

  useEffect(() => {
    void runToolCheck();
  }, [runToolCheck]);

  const handleRetryTools = useCallback(async () => {
    const status = await runToolCheck();
    if (status?.available) {
      addToast({
        kind: "success",
        title: "FFmpeg is ready",
        detail: status.version ?? undefined,
      });
    } else {
      addToast({
        kind: "error",
        title: "FFmpeg still isn’t available",
        detail: status?.error ?? "Install it with Homebrew, then try again.",
      });
    }
  }, [runToolCheck, addToast]);

  const importPaths = useCallback(
    async (paths: string[]) => {
      if (paths.length === 0) return;
      if (activeJobRef.current) {
        addToast({
          kind: "info",
          title: "Export in progress",
          detail: "Wait for the current GIF to finish before importing more clips.",
        });
        return;
      }
      if (importingRef.current) return;

      importingRef.current = true;
      setImporting(true);
      try {
        const outcome = await importMedia(paths);
        const incoming = outcome.videos;
        const existingPaths = new Set(videosRef.current.map((video) => video.path));
        const fresh = incoming.filter((video) => !existingPaths.has(video.path));

        if (incoming.length > 0) {
          setVideos((current) => {
            const byPath = new Map(current.map((video) => [video.path, video]));
            for (const video of incoming) byPath.set(video.path, video);
            return Array.from(byPath.values());
          });
          setTrims((current) => {
            const next = { ...current };
            for (const video of incoming) {
              if (!next[video.path]) next[video.path] = { start: 0, end: video.duration };
            }
            return next;
          });
          if (fresh.length > 0) {
            setSelectedPath((current) => current ?? fresh[0].path);
            addToast({
              kind: "success",
              title: fresh.length === 1 ? "Clip added" : `${fresh.length} clips added`,
              detail:
                fresh.length === 1
                  ? fresh[0].fileName
                  : "They’re ready in your library.",
            });
          } else {
            addToast({
              kind: "info",
              title: "Already in your library",
              detail:
                incoming.length === 1 ? incoming[0].fileName : "Those clips were already here.",
            });
          }
        }

        if (outcome.errors.length > 0) {
          addToast({
            kind: "error",
            title:
              outcome.videos.length > 0
                ? "Some files couldn’t be imported"
                : "Couldn’t import those files",
            detail: importErrorDetail(outcome.errors),
          });
        } else if (incoming.length === 0) {
          addToast({
            kind: "info",
            title: "No videos found",
            detail: "Choose a supported video file or a folder that contains one.",
          });
        }
      } catch (error) {
        addToast({
          kind: "error",
          title: "Import failed",
          detail: conciseError(error),
        });
      } finally {
        importingRef.current = false;
        setImporting(false);
        setDropActive(false);
      }
    },
    [addToast],
  );

  const importPathsRef = useRef(importPaths);
  importPathsRef.current = importPaths;

  const handleImportFiles = useCallback(async () => {
    if (activeJobRef.current) {
      addToast({ kind: "info", title: "Export in progress" });
      return;
    }
    if (importingRef.current) return;
    try {
      const paths = await chooseVideos();
      if (paths.length > 0) await importPathsRef.current(paths);
    } catch (error) {
      addToast({
        kind: "error",
        title: "Couldn’t open the file picker",
        detail: conciseError(error),
      });
    }
  }, [addToast]);

  const handleImportFolder = useCallback(async () => {
    if (activeJobRef.current) {
      addToast({ kind: "info", title: "Export in progress" });
      return;
    }
    if (importingRef.current) return;
    try {
      const folder = await chooseFolder();
      if (folder) await importPathsRef.current([folder]);
    } catch (error) {
      addToast({
        kind: "error",
        title: "Couldn’t open the folder picker",
        detail: conciseError(error),
      });
    }
  }, [addToast]);

  useEffect(() => {
    let unlisten: UnlistenFn | undefined;
    let disposed = false;
    void listenForDrops(
      (paths) => {
        setDropActive(false);
        void importPathsRef.current(paths);
      },
      (active) => setDropActive(active),
    )
      .then((stop) => {
        if (disposed) stop();
        else unlisten = stop;
      })
      .catch((error) => {
        console.error("Could not listen for dropped files", error);
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    let unlisten: UnlistenFn | undefined;
    let disposed = false;
    void listenForExportProgress((progress) => {
      if (progress.jobId !== activeJobRef.current) return;
      setJob((current) => {
        if (!current || current.id !== progress.jobId) return current;
        return {
          ...current,
          stage: progress.stage,
          percent: progress.percent,
          message: progress.message,
        };
      });
    })
      .then((stop) => {
        if (disposed) stop();
        else unlisten = stop;
      })
      .catch((error) => {
        console.error("Could not listen for export progress", error);
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    setPreviewMode("source");
  }, [selectedPath]);

  const handleSelectVideo = useCallback(
    (path: string) => {
      if (activeJobRef.current) {
        addToast({
          kind: "info",
          title: "Export in progress",
          detail: "You can switch clips when this GIF is finished.",
        });
        return;
      }
      setSelectedPath(path);
      setPreviewMode("source");
    },
    [addToast],
  );

  const handleRemoveVideo = useCallback(
    (path: string) => {
      if (activeJobRef.current) {
        addToast({ kind: "info", title: "Export in progress" });
        return;
      }
      const index = videos.findIndex((video) => video.path === path);
      if (index < 0) return;
      const next = videos.filter((video) => video.path !== path);
      setVideos(next);
      setTrims((current) => {
        const copy = { ...current };
        delete copy[path];
        return copy;
      });
      setResults((current) => {
        const copy = { ...current };
        delete copy[path];
        return copy;
      });
      if (selectedPath === path) {
        const fallback = next[Math.min(index, next.length - 1)]?.path ?? null;
        setSelectedPath(fallback);
        setPreviewMode("source");
      }
    },
    [videos, selectedPath, addToast],
  );

  const handleSettingsChange = useCallback(
    (patch: Partial<AppSettings>) => {
      setSettings((current) => normalizeSettings({ ...current, ...patch }));
      const touchesPreview = (Object.keys(patch) as (keyof AppSettings)[]).some((key) =>
        VISUAL_SETTING_KEYS.has(key),
      );
      if (touchesPreview) {
        setPreviewMode((current) => (current === "result" ? "source" : current));
      }
    },
    [],
  );

  const handleTrimChange = useCallback(
    (next: TrimRange) => {
      if (!selectedVideo || activeJobRef.current) return;
      const start = clamp(next.start, 0, Math.max(0, selectedVideo.duration - MIN_TRIM));
      const end = clamp(next.end, start + MIN_TRIM, selectedVideo.duration);
      setTrims((current) => ({ ...current, [selectedVideo.path]: { start, end } }));
      setPreviewMode((current) => (current === "result" ? "source" : current));
    },
    [selectedVideo],
  );

  const handleChooseOutputDir = useCallback(async () => {
    if (activeJobRef.current) return;
    try {
      const folder = await chooseOutputFolder(settings.outputDir);
      if (folder) handleSettingsChange({ outputDir: folder });
    } catch (error) {
      addToast({
        kind: "error",
        title: "Couldn’t choose an output folder",
        detail: conciseError(error),
      });
    }
  }, [settings.outputDir, handleSettingsChange, addToast]);

  const handleExport = useCallback(async () => {
    if (!selectedVideo) return;
    if (activeJobRef.current) return;
    if (!tools?.available) {
      addToast({
        kind: "error",
        title: "FFmpeg isn’t ready",
        detail: tools?.error ?? "Install FFmpeg with Homebrew, then try again.",
      });
      return;
    }

    const currentTrim = trims[selectedVideo.path] ?? {
      start: 0,
      end: selectedVideo.duration,
    };
    if (currentTrim.end - currentTrim.start < MIN_TRIM) {
      addToast({
        kind: "error",
        title: "That trim is too short",
        detail: "Choose at least a tenth of a second and try again.",
      });
      return;
    }

    const jobId = makeId();
    activeJobRef.current = jobId;
    const inputPath = selectedVideo.path;

    setJob({
      id: jobId,
      stage: "analyzing",
      percent: null,
      message: "Building a color palette from your clip…",
      cancelling: false,
    });
    setPreviewMode("source");

    try {
      const exported = await exportGif({
        jobId,
        inputPath,
        trimStart: currentTrim.start,
        trimEnd: currentTrim.end,
        settings,
      });
      setResults((current) => ({ ...current, [inputPath]: exported }));
      setPreviewMode("result");
      addToast({
        kind: "success",
        title: "Your GIF is ready",
        detail: `${exported.fileName} · ${formatBytes(exported.fileSize)}`,
      });
    } catch (error) {
      const message = readError(error);
      if (message.includes(EXPORT_CANCELLED)) {
        addToast({
          kind: "info",
          title: "Export cancelled",
          detail: "No GIF was created.",
        });
      } else {
        addToast({
          kind: "error",
          title: "Export failed",
          detail: conciseError(error),
        });
      }
    } finally {
      if (activeJobRef.current === jobId) activeJobRef.current = null;
      setJob((current) => (current?.id === jobId ? null : current));
    }
  }, [selectedVideo, tools, trims, settings, addToast]);

  const handleCancelExport = useCallback(async () => {
    if (!activeJobRef.current || !job || job.cancelling) return;
    setJob((current) => (current ? { ...current, cancelling: true } : current));
    try {
      await cancelExport();
    } catch (error) {
      setJob((current) => (current ? { ...current, cancelling: false } : current));
      addToast({
        kind: "error",
        title: "Couldn’t cancel the export",
        detail: conciseError(error),
      });
    }
  }, [job, addToast]);

  const handleRevealResult = useCallback(async () => {
    if (!result) return;
    try {
      await revealInFinder(result.outputPath);
    } catch (error) {
      addToast({
        kind: "error",
        title: "Couldn’t reveal the GIF",
        detail: conciseError(error),
      });
    }
  }, [result, addToast]);

  const handleOpenResult = useCallback(async () => {
    if (!result) return;
    try {
      await openFile(result.outputPath);
    } catch (error) {
      addToast({
        kind: "error",
        title: "Couldn’t open the GIF",
        detail: conciseError(error),
      });
    }
  }, [result, addToast]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const command = event.metaKey || event.ctrlKey;

      if (command && event.key.toLowerCase() === "o") {
        event.preventDefault();
        if (event.shiftKey) void handleImportFolder();
        else void handleImportFiles();
        return;
      }
      if (command && event.key === "Enter") {
        event.preventDefault();
        void handleExport();
        return;
      }
      if (event.key === "Escape" && activeJobRef.current) {
        event.preventDefault();
        void handleCancelExport();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleImportFolder, handleImportFiles, handleExport, handleCancelExport]);

  return (
    <div className="app-shell">
      <TitleBar video={selectedVideo} saveState={saveState} />

      <div className="app-body">
        <Sidebar
          videos={videos}
          selectedPath={selectedPath}
          importing={importing}
          tools={tools}
          onSelect={handleSelectVideo}
          onRemove={handleRemoveVideo}
          onImportFiles={() => void handleImportFiles()}
          onImportFolder={() => void handleImportFolder()}
        />

        <main className="workspace">
          <Preview
            video={selectedVideo}
            trim={trim}
            settings={settings}
            mode={previewMode}
            result={result}
            job={job}
            tools={tools}
            importing={importing}
            onModeChange={setPreviewMode}
            onTrimChange={handleTrimChange}
            onImportFiles={() => void handleImportFiles()}
            onImportFolder={() => void handleImportFolder()}
            onCancelExport={() => void handleCancelExport()}
            onRevealResult={() => void handleRevealResult()}
            onOpenResult={() => void handleOpenResult()}
          />
        </main>

        <Inspector
          settings={settings}
          video={selectedVideo}
          trim={trim}
          tools={tools}
          job={job}
          checkingTools={checkingTools}
          onSettingsChange={handleSettingsChange}
          onChooseOutputDir={() => void handleChooseOutputDir()}
          onClearOutputDir={() => handleSettingsChange({ outputDir: null })}
          onRetryTools={() => void handleRetryTools()}
          onExport={() => void handleExport()}
          onCancelExport={() => void handleCancelExport()}
        />
      </div>

      <ToastStack toasts={toasts} onDismiss={dismissToast} />

      {dropActive && (
        <div className="drop-overlay" aria-hidden="true">
          <div className="drop-well">
            <span className="drop-icon">
              <Download size={24} />
            </span>
            <strong>Drop to add to your library</strong>
            <span>Videos or folders — we’ll take it from here.</span>
          </div>
        </div>
      )}
    </div>
  );
}
