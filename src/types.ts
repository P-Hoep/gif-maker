export type PlaybackMode = "forward" | "reverse" | "boomerang";
export type DitherMode = "sierra" | "bayer" | "none";
export type TitlePosition = "top" | "bottom";
export type TextStyle = "shadow" | "scrim";
export type Typeface = "sans" | "serif";

export interface VideoAsset {
  path: string;
  name: string;
  fileName: string;
  extension: string;
  duration: number;
  width: number;
  height: number;
  fps: number;
  codec: string;
  fileSize: number;
  thumbnail: string | null;
}

export interface ImportOutcome {
  videos: VideoAsset[];
  errors: string[];
}

export interface ToolsStatus {
  available: boolean;
  version: string | null;
  ffmpegPath: string | null;
  ffprobePath: string | null;
  error: string | null;
}

export interface AppSettings {
  playback: PlaybackMode;
  width: number;
  fps: number;
  colors: number;
  dither: DitherMode;
  loopForever: boolean;
  optimize: boolean;
  titleText: string;
  creditText: string;
  titlePosition: TitlePosition;
  textStyle: TextStyle;
  typeface: Typeface;
  textScale: number;
  outputDir: string | null;
}

export interface TrimRange {
  start: number;
  end: number;
}

export interface ExportRequest {
  jobId: string;
  inputPath: string;
  trimStart: number;
  trimEnd: number;
  settings: AppSettings;
}

export interface ExportProgress {
  jobId: string;
  stage: "analyzing" | "rendering" | "finalizing" | "done";
  percent: number | null;
  message: string;
}

export interface ExportResult {
  outputPath: string;
  fileName: string;
  fileSize: number;
  width: number;
  height: number;
  duration: number;
  frameCount: number;
}

export interface ActiveJob {
  id: string;
  stage: string;
  percent: number | null;
  message: string;
  cancelling: boolean;
}

export type PreviewMode = "source" | "result";

export type SaveState = "idle" | "saving" | "saved" | "error";

export type ToastKind = "success" | "error" | "info";

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastItem {
  id: string;
  kind: ToastKind;
  title: string;
  detail?: string;
  action?: ToastAction;
}

export const DEFAULT_SETTINGS: AppSettings = {
  playback: "forward",
  width: 640,
  fps: 15,
  colors: 160,
  dither: "sierra",
  loopForever: true,
  optimize: true,
  titleText: "",
  creditText: "",
  titlePosition: "top",
  textStyle: "shadow",
  typeface: "sans",
  textScale: 100,
  outputDir: null,
};

export const VIDEO_FILTER = {
  name: "Videos",
  extensions: [
    "mp4",
    "mov",
    "m4v",
    "qt",
    "mkv",
    "webm",
    "avi",
    "mpg",
    "mpeg",
    "m2v",
    "wmv",
    "flv",
    "3gp",
    "3g2",
    "mts",
    "m2ts",
    "ts",
    "ogv",
    "asf",
    "vob",
    "f4v",
  ],
};
