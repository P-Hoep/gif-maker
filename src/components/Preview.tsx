import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  ExternalLink,
  FileImage,
  Film,
  FolderOpen,
  LoaderCircle,
  Pause,
  Play,
  Plus,
  Repeat2,
  RotateCcw,
  Scissors,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type {
  ActiveJob,
  AppSettings,
  ExportResult,
  PreviewMode,
  ToolsStatus,
  TrimRange,
  VideoAsset,
} from "../types";
import { assetUrl } from "../lib/api";
import {
  clamp,
  formatBytes,
  formatDimensions,
  formatDuration,
  outputDimensions,
  outputDuration,
} from "../lib/format";
import { BrandMark } from "./BrandMark";

const MIN_TRIM_GAP = 0.1;

const PLAYBACK_META = {
  forward: { label: "Forward", Icon: ArrowRight },
  reverse: { label: "Reverse", Icon: ArrowLeft },
  boomerang: { label: "Boomerang", Icon: Repeat2 },
} as const;

const STAGE_META: Record<string, { title: string; note: string }> = {
  analyzing: { title: "Building the color palette", note: "Finding the richest colors for this clip" },
  rendering: { title: "Rendering your GIF", note: "Quantizing frames with the fresh palette" },
  finalizing: { title: "Finishing touches", note: "Writing the final file" },
  done: { title: "All done", note: "Preparing your GIF" },
};

interface PreviewProps {
  video: VideoAsset | null;
  trim: TrimRange | null;
  settings: AppSettings;
  mode: PreviewMode;
  result: ExportResult | null;
  job: ActiveJob | null;
  tools: ToolsStatus | null;
  importing: boolean;
  onModeChange: (mode: PreviewMode) => void;
  onTrimChange: (trim: TrimRange) => void;
  onImportFiles: () => void;
  onImportFolder: () => void;
  onImportGifs: () => void;
  onCancelExport: () => void;
  onRevealResult: () => void;
  onOpenResult: () => void;
}

interface TimelineProps {
  duration: number;
  trim: TrimRange;
  currentTime: number;
  onSeek: (time: number) => void;
  onScrubStart: () => void;
  onTrimChange: (trim: TrimRange) => void;
}

type DragKind = "start" | "end" | "seek";

function Timeline({ duration, trim, currentTime, onSeek, onScrubStart, onTrimChange }: TimelineProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragKind | null>(null);
  const latestRef = useRef({ duration, trim });
  latestRef.current = { duration, trim };

  const start = Math.max(0, Math.min(trim.start, duration));
  const end = Math.max(start, Math.min(trim.end, duration));
  const startPercent = duration > 0 ? (start / duration) * 100 : 0;
  const endPercent = duration > 0 ? (end / duration) * 100 : 0;
  const playPercent = duration > 0 ? (clamp(currentTime, start, end) / duration) * 100 : 0;

  const timeAt = (clientX: number) => {
    const element = trackRef.current;
    if (!element) return 0;
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0) return 0;
    return clamp((clientX - rect.left) / rect.width, 0, 1) * latestRef.current.duration;
  };

  const updateDrag = (clientX: number) => {
    const kind = dragRef.current;
    if (!kind) return;
    const { duration: total, trim: range } = latestRef.current;
    const time = timeAt(clientX);

    if (kind === "seek") {
      onSeek(clamp(time, range.start, range.end));
      return;
    }

    if (kind === "start") {
      const next = clamp(Math.min(time, range.end - MIN_TRIM_GAP), 0, total);
      onTrimChange({ start: next, end: range.end });
      onSeek(next);
    } else {
      const next = clamp(Math.max(time, range.start + MIN_TRIM_GAP), 0, total);
      onTrimChange({ start: range.start, end: next });
      onSeek(next);
    }
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (duration <= 0 || event.button !== 0) return;
    const handle = (event.target as HTMLElement).closest<HTMLElement>("[data-handle]");
    const kind: DragKind =
      handle?.dataset.handle === "start" ? "start" : handle?.dataset.handle === "end" ? "end" : "seek";

    dragRef.current = kind;
    event.currentTarget.setPointerCapture(event.pointerId);
    onScrubStart();

    const time = timeAt(event.clientX);
    if (kind === "seek") {
      onSeek(clamp(time, trim.start, trim.end));
      return;
    }
    const next =
      kind === "start"
        ? clamp(Math.min(time, trim.end - MIN_TRIM_GAP), 0, duration)
        : clamp(Math.max(time, trim.start + MIN_TRIM_GAP), 0, duration);
    onTrimChange(kind === "start" ? { start: next, end: trim.end } : { start: trim.start, end: next });
    onSeek(next);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    updateDrag(event.clientX);
  };

  const finishDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const nudgeHandle = (
    event: ReactKeyboardEvent<HTMLDivElement>,
    kind: "start" | "end",
    value: number,
  ) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    event.stopPropagation();
    onScrubStart();
    const direction = event.key === "ArrowRight" ? 1 : -1;
    const step = event.shiftKey ? 1 : 0.1;
    const next =
      kind === "start"
        ? clamp(value + direction * step, 0, trim.end - MIN_TRIM_GAP)
        : clamp(value + direction * step, trim.start + MIN_TRIM_GAP, duration);
    onTrimChange(kind === "start" ? { start: next, end: trim.end } : { start: trim.start, end: next });
    onSeek(next);
  };

  return (
    <div
      className="timeline"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishDrag}
      onPointerCancel={finishDrag}
    >
      <div className="timeline-track" ref={trackRef}>
        <span
          className="timeline-selection"
          style={{ left: `${startPercent}%`, width: `${Math.max(0, endPercent - startPercent)}%` }}
        />
        <span className="timeline-playhead" style={{ left: `${playPercent}%` }} />
        <div
          className="trim-handle trim-handle-start"
          style={{ left: `${startPercent}%` }}
          data-handle="start"
          role="slider"
          aria-label="Trim in point"
          aria-orientation="horizontal"
          aria-valuemin={0}
          aria-valuemax={Math.round((trim.end - MIN_TRIM_GAP) * 100) / 100}
          aria-valuenow={Math.round(start * 100) / 100}
          aria-valuetext={formatDuration(start, true)}
          tabIndex={0}
          onKeyDown={(event) => nudgeHandle(event, "start", start)}
        >
          <span />
        </div>
        <div
          className="trim-handle trim-handle-end"
          style={{ left: `${endPercent}%` }}
          data-handle="end"
          role="slider"
          aria-label="Trim out point"
          aria-orientation="horizontal"
          aria-valuemin={Math.round((trim.start + MIN_TRIM_GAP) * 100) / 100}
          aria-valuemax={Math.round(duration * 100) / 100}
          aria-valuenow={Math.round(end * 100) / 100}
          aria-valuetext={formatDuration(end, true)}
          tabIndex={0}
          onKeyDown={(event) => nudgeHandle(event, "end", end)}
        >
          <span />
        </div>
      </div>
    </div>
  );
}

function TextOverlay({ settings, height }: { settings: AppSettings; height: number }) {
  const title = settings.titleText.trim();
  const credit = settings.creditText.trim();
  if (!title && !credit) return null;

  const marginX = Math.max(8, height * 0.065);
  const marginY = Math.max(6, height * 0.06);
  const titleSize = clamp(height * 0.083 * (settings.textScale / 100), 8, 160);
  const creditSize = clamp(height * 0.039 * (settings.textScale / 100), 6, 72);
  const titleOnTop = settings.titlePosition === "top";
  const shadow = `0 ${Math.max(1, height / 500)}px ${Math.max(2, height * 0.008)}px rgba(0, 0, 0, 0.9)`;
  const fontFamily =
    settings.typeface === "serif"
      ? 'Georgia, "Times New Roman", serif'
      : 'Arial, "Helvetica Neue", Helvetica, sans-serif';

  const topHasText = titleOnTop ? Boolean(title) : Boolean(credit);
  const bottomHasText = titleOnTop ? Boolean(credit) : Boolean(title);
  const topKind = titleOnTop ? "title" : "credit";
  const topText = titleOnTop ? title : credit;

  return (
    <div className="text-overlay" aria-hidden="true">
      {settings.textStyle === "scrim" && topHasText && <span className="preview-scrim is-top" />}
      {settings.textStyle === "scrim" && bottomHasText && <span className="preview-scrim is-bottom" />}

      {topHasText && (
        <div
          className={`overlay-slot is-${topKind} is-top`}
          style={{
            padding: `${marginY}px ${marginX}px`,
            fontFamily,
            fontSize: topKind === "title" ? titleSize : creditSize,
            textShadow: shadow,
          }}
        >
          <span>{topText}</span>
        </div>
      )}

      {bottomHasText && (
        <div
          className={`overlay-slot is-${titleOnTop ? "credit" : "title"} is-bottom`}
          style={{
            padding: `${marginY}px ${marginX}px`,
            fontFamily,
            fontSize: titleOnTop ? creditSize : titleSize,
            textShadow: shadow,
          }}
        >
          <span>{titleOnTop ? credit : title}</span>
        </div>
      )}
    </div>
  );
}

function EmptyStage({
  importing,
  tools,
  onImportFiles,
  onImportFolder,
  onImportGifs,
}: {
  importing: boolean;
  tools: ToolsStatus | null;
  onImportFiles: () => void;
  onImportFolder: () => void;
  onImportGifs: () => void;
}) {
  return (
    <div className="empty-stage">
      <div className="empty-art" aria-hidden="true">
        <span className="empty-glow" />
        <span className="empty-card empty-card-back">
          <span />
          <span />
        </span>
        <span className="empty-card empty-card-mid" />
        <span className="empty-card empty-card-front">
          <BrandMark size={54} />
          <span className="empty-play">
            <Play size={13} fill="currentColor" />
          </span>
        </span>
        <span className="empty-loop-chip">
          <Repeat2 size={12} />
          loop
        </span>
        <span className="empty-spark is-one" />
        <span className="empty-spark is-two" />
      </div>

      <p className="empty-kicker">VIDEO TO GIF</p>
      <h1 className="empty-title">
        Make a moment <em>loop.</em>
      </h1>
      <p className="empty-description">
        Drop a clip anywhere, or bring one in. Trim it, add a title, and make a GIF worth
        sending.
      </p>

      <div className="empty-actions">
        <button
          type="button"
          className="button button-primary"
          onClick={onImportFiles}
          disabled={importing}
        >
          {importing ? <LoaderCircle size={15} className="spin" /> : <Plus size={15} />}
          {importing ? "Importing…" : "Import videos"}
        </button>
        <button
          type="button"
          className="button button-quiet"
          onClick={onImportGifs}
          disabled={importing}
          title="Import a GIF to trim and re-export (⇧⌘G)"
        >
          <FileImage size={15} />
          Import a GIF
        </button>
        <button
          type="button"
          className="button button-quiet"
          onClick={onImportFolder}
          disabled={importing}
        >
          <FolderOpen size={15} />
          Choose a folder
        </button>
      </div>

      <p className="empty-formats">MP4 · MOV · MKV · WebM · AVI · GIF · and more</p>

      {tools && !tools.available && (
        <div className="empty-warning" role="status">
          <AlertTriangle size={14} />
          <span>FFmpeg is missing. Install it with Homebrew, then reopen Gifsmith.</span>
        </div>
      )}
    </div>
  );
}

function JobCard({ job, onCancel }: { job: ActiveJob; onCancel: () => void }) {
  const meta = STAGE_META[job.stage] ?? { title: job.message, note: "" };
  const indeterminate = job.percent === null;

  return (
    <div className="job-overlay">
      <div className="job-card" role="status" aria-live="polite">
        <div className="job-heading">
          <span className="job-spinner">
            <LoaderCircle size={17} className="spin" />
          </span>
          <div className="job-copy">
            <strong>{meta.title}</strong>
            <span>{meta.note || job.message}</span>
          </div>
          {!job.cancelling && (
            <button type="button" className="job-cancel" onClick={onCancel}>
              Cancel
            </button>
          )}
          {job.cancelling && <span className="job-cancelling">Cancelling…</span>}
        </div>
        <div className={`job-progress${indeterminate ? " is-indeterminate" : ""}`}>
          <span style={indeterminate ? undefined : { width: `${job.percent ?? 0}%` }} />
        </div>
        <div className="job-foot">
          <span>{job.message}</span>
          <span>{indeterminate ? "Working…" : `${Math.round(job.percent ?? 0)}%`}</span>
        </div>
      </div>
    </div>
  );
}

export function Preview({
  video,
  trim,
  settings,
  mode,
  result,
  job,
  tools,
  importing,
  onModeChange,
  onTrimChange,
  onImportFiles,
  onImportFolder,
  onImportGifs,
  onCancelExport,
  onRevealResult,
  onOpenResult,
}: PreviewProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
  const [currentTime, setCurrentTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [mediaError, setMediaError] = useState(false);

  const duration = Math.max(0, video?.duration ?? 0);
  const safeTrim = useMemo<TrimRange>(() => {
    const start = clamp(trim?.start ?? 0, 0, Math.max(0, duration - MIN_TRIM_GAP));
    const end = clamp(trim?.end ?? duration, start + MIN_TRIM_GAP, duration);
    return { start, end };
  }, [trim?.start, trim?.end, duration]);

  const showResult = mode === "result" && result !== null;
  const playback = PLAYBACK_META[settings.playback];
  const outSize = outputDimensions(video, settings);
  const trimLength = Math.max(0, safeTrim.end - safeTrim.start);

  useEffect(() => {
    const element = stageRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      setStageSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    setPlaying(false);
    setMediaError(false);
    setCurrentTime(safeTrim.start);
    const element = videoRef.current;
    if (!element) return;
    element.pause();
    try {
      element.currentTime = safeTrim.start;
    } catch {
      // The video may not have metadata yet; the browser will seek on load.
    }
    // Only reset the player when the source clip changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [video?.path]);

  useEffect(() => {
    const element = videoRef.current;
    if (!element) return;
    if (element.currentTime < safeTrim.start || element.currentTime > safeTrim.end) {
      try {
        element.currentTime = safeTrim.start;
      } catch {
        // Ignore seeks before metadata is available.
      }
      setCurrentTime(safeTrim.start);
    }
  }, [safeTrim.start, safeTrim.end]);

  useEffect(() => {
    if (mode === "result") {
      videoRef.current?.pause();
      setPlaying(false);
    }
  }, [mode]);

  const seekTo = useCallback(
    (time: number) => {
      const element = videoRef.current;
      const next = clamp(time, safeTrim.start, safeTrim.end);
      if (element) {
        try {
          element.currentTime = next;
        } catch {
          // Ignore; the state still keeps the timeline responsive.
        }
      }
      setCurrentTime(next);
    },
    [safeTrim.start, safeTrim.end],
  );

  const pausePreview = useCallback(() => {
    const element = videoRef.current;
    if (element && !element.paused) element.pause();
    setPlaying(false);
  }, []);

  // Freeze the preview underneath the export card so the rendered GIF matches what was seen.
  useEffect(() => {
    if (job) pausePreview();
  }, [job, pausePreview]);

  // A new export supersedes the previous result; show the source clip while it renders.
  useEffect(() => {
    if (job && mode === "result") onModeChange("source");
  }, [job, mode, onModeChange]);

  const handleSeek = useCallback(
    (time: number) => {
      pausePreview();
      seekTo(time);
    },
    [pausePreview, seekTo],
  );

  const togglePlay = useCallback(() => {
    const element = videoRef.current;
    if (!element || !video || mediaError) return;
    if (!element.paused) {
      element.pause();
      return;
    }
    if (
      element.currentTime < safeTrim.start + 0.01 ||
      element.currentTime >= safeTrim.end - 0.02
    ) {
      try {
        element.currentTime = safeTrim.start;
      } catch {
        // Ignore.
      }
    }
    const attempt = element.play();
    if (attempt) {
      void attempt.catch(() => setPlaying(false));
    }
  }, [video, mediaError, safeTrim.start, safeTrim.end]);

  const setInPoint = useCallback(() => {
    const next = clamp(currentTime, 0, safeTrim.end - MIN_TRIM_GAP);
    onTrimChange({ start: next, end: safeTrim.end });
    seekTo(next);
  }, [currentTime, safeTrim.end, onTrimChange, seekTo]);

  const setOutPoint = useCallback(() => {
    const next = clamp(currentTime, safeTrim.start + MIN_TRIM_GAP, duration);
    onTrimChange({ start: safeTrim.start, end: next });
    seekTo(next);
  }, [currentTime, safeTrim.start, duration, onTrimChange, seekTo]);

  const resetTrim = useCallback(() => {
    onTrimChange({ start: 0, end: duration });
    seekTo(0);
  }, [duration, onTrimChange, seekTo]);

  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    const tick = () => {
      const element = videoRef.current;
      if (element) {
        if (element.currentTime >= safeTrim.end) {
          if (settings.loopForever) {
            try {
              element.currentTime = safeTrim.start;
            } catch {
              // Ignore.
            }
            setCurrentTime(safeTrim.start);
          } else {
            element.pause();
            setCurrentTime(safeTrim.end);
            setPlaying(false);
            return;
          }
        } else if (element.currentTime >= safeTrim.start) {
          setCurrentTime(element.currentTime);
        }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, safeTrim.start, safeTrim.end, settings.loopForever]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (
        target?.closest(
          "input, textarea, select, [contenteditable='true'], button, a, [role='slider']",
        )
      ) {
        return;
      }
      if (!video || mode !== "source") return;

      if (event.code === "Space") {
        event.preventDefault();
        togglePlay();
      } else if (event.key.toLowerCase() === "i") {
        event.preventDefault();
        pausePreview();
        setInPoint();
      } else if (event.key.toLowerCase() === "o") {
        event.preventDefault();
        pausePreview();
        setOutPoint();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [video, mode, togglePlay, pausePreview, setInPoint, setOutPoint]);

  const aspect = useMemo(() => {
    if (showResult && result) return result.width / Math.max(1, result.height);
    if (video) return video.width / Math.max(1, video.height);
    return 16 / 9;
  }, [showResult, result, video]);

  const frame = useMemo(() => {
    if (stageSize.width <= 0 || stageSize.height <= 0) return { width: 0, height: 0 };
    let width = stageSize.width;
    let height = width / aspect;
    if (height > stageSize.height) {
      height = stageSize.height;
      width = height * aspect;
    }
    return { width: Math.floor(width), height: Math.floor(height) };
  }, [stageSize, aspect]);

  const trimmed = trimLength < duration - 0.05 || safeTrim.start > 0.001;

  return (
    <section className="preview-pane">
      <div className="preview-head">
        <div className="preview-heading">
          {result ? (
            <div className="preview-tabs" role="tablist" aria-label="Preview mode">
              <button
                type="button"
                role="tab"
                aria-selected={mode === "source"}
                className={`preview-tab${mode === "source" ? " is-active" : ""}`}
                onClick={() => onModeChange("source")}
              >
                Source
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === "result"}
                className={`preview-tab${mode === "result" ? " is-active" : ""}`}
                onClick={() => onModeChange("result")}
                disabled={Boolean(job)}
                title={job ? "Wait for the current export to finish" : undefined}
              >
                GIF
                <span className="tab-dot" />
              </button>
            </div>
          ) : (
            <span className="preview-label">Preview</span>
          )}
        </div>

        {video && (
          <div className="preview-head-meta">
            <span className="playback-chip">
              <playback.Icon size={12} />
              {playback.label}
            </span>
            <span className="preview-spec">
              {showResult && result
                ? `${formatDimensions(result.width, result.height)} · ${formatBytes(result.fileSize)}`
                : `${outSize ? formatDimensions(outSize.width, outSize.height) : "—"} · ${settings.fps} fps`}
            </span>
          </div>
        )}
      </div>

      <div className={`stage${video ? " has-media" : " is-empty"}`} ref={stageRef}>
        {!video && (
          <EmptyStage
            importing={importing}
            tools={tools}
            onImportFiles={onImportFiles}
            onImportFolder={onImportFolder}
            onImportGifs={onImportGifs}
          />
        )}

        {video && (
          <div
            className={`media-frame${showResult ? " is-result" : ""}${job ? " is-working" : ""}`}
            style={{ width: frame.width || undefined, height: frame.height || undefined }}
          >
            {!showResult && (
              <>
                <video
                  key={video.path}
                  ref={videoRef}
                  className={`preview-video${mediaError ? " is-hidden" : ""}`}
                  src={assetUrl(video.path)}
                  poster={video.thumbnail ?? undefined}
                  muted
                  playsInline
                  preload="auto"
                  onClick={togglePlay}
                  onPlay={() => setPlaying(true)}
                  onPause={() => setPlaying(false)}
                  onError={() => setMediaError(true)}
                  onLoadedMetadata={() => {
                    setMediaError(false);
                    if (videoRef.current) {
                      try {
                        videoRef.current.currentTime = Math.max(
                          safeTrim.start,
                          videoRef.current.currentTime,
                        );
                      } catch {
                        // Ignore.
                      }
                    }
                  }}
                />

                {mediaError && (
                  <div className="media-fallback">
                    {video.thumbnail ? (
                      <img src={video.thumbnail} alt="" />
                    ) : (
                      <span className="media-fallback-mark">
                        <Film size={30} />
                      </span>
                    )}
                    <div className="media-fallback-note">
                      <AlertTriangle size={14} />
                      This clip can’t be previewed here, but it can still be exported.
                    </div>
                  </div>
                )}

                <TextOverlay settings={settings} height={frame.height} />

                {!playing && !mediaError && !job && (
                  <button
                    type="button"
                    className="stage-play-button"
                    onClick={togglePlay}
                    aria-label="Play preview"
                  >
                    <Play size={18} fill="currentColor" />
                  </button>
                )}

                {!job && (
                  <span className="stage-badge">
                    <span className="stage-badge-dot" />
                    {trimmed ? `${formatDuration(trimLength, true)} selection` : formatDuration(duration)}
                  </span>
                )}
              </>
            )}

            {showResult && result && (
              <>
                <img
                  className="preview-gif"
                  src={assetUrl(result.outputPath)}
                  alt={`Exported GIF: ${result.fileName}`}
                  draggable={false}
                />
                <span className="stage-badge is-result">
                  <span className="stage-badge-dot" />
                  {result.frameCount.toLocaleString()} frames
                </span>
              </>
            )}

            {job && <JobCard job={job} onCancel={onCancelExport} />}
          </div>
        )}
      </div>

      {video && !showResult && !job && (
        <div className="transport">
          <div className="transport-main">
            <button
              type="button"
              className="transport-play"
              onClick={togglePlay}
              aria-label={playing ? "Pause preview" : "Play preview"}
            >
              {playing ? (
                <Pause size={15} fill="currentColor" />
              ) : (
                <Play size={15} fill="currentColor" />
              )}
            </button>

            <div className="timeline-wrap">
              <Timeline
                duration={duration}
                trim={safeTrim}
                currentTime={currentTime}
                onSeek={handleSeek}
                onScrubStart={pausePreview}
                onTrimChange={onTrimChange}
              />
              <div className="timeline-meta">
                <span className="time-readout">{formatDuration(currentTime, true)}</span>
                <span className="trim-readout">
                  <span className="trim-dot" />
                  {formatDuration(safeTrim.start, true)}
                  <span className="trim-arrow">→</span>
                  {formatDuration(safeTrim.end, true)}
                  <strong>{formatDuration(trimLength, true)}</strong>
                </span>
                <span className="time-readout is-total">{formatDuration(duration, true)}</span>
              </div>
            </div>
          </div>

          <div className="transport-footer">
            <div className="trim-tools">
              <span className="trim-tools-label">
                <Scissors size={12} />
                Trim
              </span>
              <button
                type="button"
                className="text-button"
                onClick={() => {
                  pausePreview();
                  setInPoint();
                }}
                disabled={currentTime >= safeTrim.end - MIN_TRIM_GAP}
                title="Set the in point at the playhead (I)"
              >
                Set in <kbd>I</kbd>
              </button>
              <button
                type="button"
                className="text-button"
                onClick={() => {
                  pausePreview();
                  setOutPoint();
                }}
                disabled={currentTime <= safeTrim.start + MIN_TRIM_GAP}
                title="Set the out point at the playhead (O)"
              >
                Set out <kbd>O</kbd>
              </button>
              <button
                type="button"
                className="text-button"
                onClick={resetTrim}
                disabled={!trimmed}
                title="Use the whole clip"
              >
                <RotateCcw size={11} />
                Reset
              </button>
            </div>
            <span className="transport-hint">Click or drag the timeline to scrub</span>
          </div>
        </div>
      )}

      {video && showResult && result && !job && (
        <div className="result-bar">
          <div className="result-info">
            <span className="result-check">
              <Check size={15} strokeWidth={2.6} />
            </span>
            <div className="result-copy">
              <strong>Your GIF is ready</strong>
              <span title={result.outputPath}>
                {result.fileName} · {formatDimensions(result.width, result.height)} ·{" "}
                {formatDuration(result.duration, true)} · {formatBytes(result.fileSize)}
              </span>
            </div>
          </div>
          <div className="result-actions">
            <button type="button" className="button button-quiet button-small" onClick={onOpenResult}>
              <ExternalLink size={13} />
              Open
            </button>
            <button
              type="button"
              className="button button-quiet button-small"
              onClick={onRevealResult}
            >
              <FolderOpen size={13} />
              Show in Finder
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
