import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  FolderClosed,
  LoaderCircle,
  RefreshCw,
  Repeat2,
  Sparkles,
  X,
} from "lucide-react";
import type {
  ActiveJob,
  AppSettings,
  DitherMode,
  PlaybackMode,
  TextStyle,
  TitlePosition,
  ToolsStatus,
  TrimRange,
  Typeface,
  VideoAsset,
} from "../types";
import {
  clamp,
  compactPath,
  formatDimensions,
  formatDuration,
  outputDimensions,
  outputDuration,
} from "../lib/format";
import { Segmented, SliderField, Switch, SectionHeading } from "./Controls";

interface InspectorProps {
  settings: AppSettings;
  video: VideoAsset | null;
  trim: TrimRange | null;
  tools: ToolsStatus | null;
  job: ActiveJob | null;
  checkingTools: boolean;
  onSettingsChange: (patch: Partial<AppSettings>) => void;
  onChooseOutputDir: () => void;
  onClearOutputDir: () => void;
  onRetryTools: () => void;
  onExport: () => void;
  onCancelExport: () => void;
}

const WIDTH_PRESETS = [320, 480, 640, 960];

function WidthControl({
  settings,
  video,
  onChange,
}: {
  settings: AppSettings;
  video: VideoAsset | null;
  onChange: (width: number) => void;
}) {
  const output = outputDimensions(video, settings);
  const sourceWidth = video?.width ?? 0;

  return (
    <div className="field width-field">
      <div className="slider-heading">
        <label className="field-label" htmlFor="gif-width">
          Width
        </label>
        <div className="number-input">
          <input
            id="gif-width"
            type="number"
            min={0}
            max={1600}
            step={10}
            inputMode="numeric"
            placeholder="Auto"
            value={settings.width === 0 ? "" : String(settings.width)}
            onChange={(event) => {
              const raw = event.target.value;
              if (raw === "") {
                onChange(0);
                return;
              }
              const parsed = Number(raw);
              if (Number.isFinite(parsed)) onChange(clamp(Math.round(parsed), 0, 1600));
            }}
          />
          <span>px</span>
        </div>
      </div>

      <div className="preset-row">
        <button
          type="button"
          className={`preset${settings.width === 0 ? " is-active" : ""}`}
          onClick={() => onChange(0)}
        >
          Source
        </button>
        {WIDTH_PRESETS.map((preset) => (
          <button
            key={preset}
            type="button"
            className={`preset${settings.width === preset ? " is-active" : ""}`}
            onClick={() => onChange(preset)}
            disabled={sourceWidth > 0 && preset > sourceWidth}
            title={
              sourceWidth > 0 && preset > sourceWidth
                ? `This clip is only ${sourceWidth}px wide`
                : undefined
            }
          >
            {preset}
          </button>
        ))}
      </div>

      <span className="field-help">
        {output
          ? `Outputs ${formatDimensions(output.width, output.height)} at the source aspect ratio.`
          : "Height follows the source aspect ratio."}
      </span>
    </div>
  );
}

function DitherHelp({ dither }: { dither: DitherMode }) {
  if (dither === "bayer") return <>Cross-hatched texture keeps gradients crisp and files small.</>;
  if (dither === "none") return <>Cleanest edges, but color bands can appear in soft gradients.</>;
  return <>Soft, photographic dithering. A good default for sharing.</>;
}

export function Inspector({
  settings,
  video,
  trim,
  tools,
  job,
  checkingTools,
  onSettingsChange,
  onChooseOutputDir,
  onClearOutputDir,
  onRetryTools,
  onExport,
  onCancelExport,
}: InspectorProps) {
  const update = onSettingsChange;
  const output = outputDimensions(video, settings);
  const trimLength = video
    ? Math.max(0, (trim?.end ?? video.duration) - (trim?.start ?? 0))
    : 0;
  const outDuration = video
    ? outputDuration(trim ?? { start: 0, end: video.duration }, settings.playback === "boomerang")
    : 0;
  const frameCount = outDuration > 0 ? Math.max(1, Math.round(outDuration * settings.fps)) : 0;
  const canExport = Boolean(video) && Boolean(tools?.available) && !job;
  const toolsMissing = tools !== null && !tools.available;

  const exportLabel = !video
    ? "Choose a clip to begin"
    : toolsMissing
      ? "FFmpeg is required"
      : tools === null
        ? "Checking FFmpeg…"
        : null;

  return (
    <aside className="inspector">
      <div className="inspector-scroll">
        <div className="inspector-intro">
          <span className="inspector-kicker">Export recipe</span>
          <h2>Shape your GIF</h2>
          <p>Your choices are remembered for next time.</p>
        </div>

        {toolsMissing && (
          <div className="tools-alert">
            <div className="tools-alert-title">
              <AlertTriangle size={15} />
              <strong>FFmpeg is missing</strong>
            </div>
            <p>
              Gifsmith uses FFmpeg to read clips and render GIFs. Install it with{" "}
              <code>brew install ffmpeg</code>, then check again.
            </p>
            {tools.error && <span className="tools-alert-detail">{tools.error}</span>}
            <button
              type="button"
              className="text-button"
              onClick={onRetryTools}
              disabled={checkingTools}
            >
              {checkingTools ? (
                <LoaderCircle size={12} className="spin" />
              ) : (
                <RefreshCw size={12} />
              )}
              {checkingTools ? "Checking…" : "Check again"}
            </button>
          </div>
        )}

        <section className="inspector-section">
          <SectionHeading eyebrow="Motion" title="How it plays" />
          <Segmented<PlaybackMode>
            label="Playback direction"
            value={settings.playback}
            onChange={(playback) => update({ playback })}
            options={[
              { value: "forward", label: "Forward", icon: <ArrowRight size={14} /> },
              { value: "reverse", label: "Reverse", icon: <ArrowLeft size={14} /> },
              {
                value: "boomerang",
                label: "Boomerang",
                icon: <Repeat2 size={14} />,
              },
            ]}
          />
          <p className="mode-note">
            {settings.playback === "reverse"
              ? "The selection plays backwards from the out point."
              : settings.playback === "boomerang"
                ? "Forward, then back. Boomerang doubles the GIF’s length."
                : "The selection plays in its original direction."}
          </p>
          <Switch
            checked={settings.loopForever}
            onChange={(loopForever) => update({ loopForever })}
            label="Loop forever"
            help="Restart automatically after the last frame."
          />
        </section>

        <section className="inspector-section">
          <SectionHeading eyebrow="Size & color" title="Tune the output" />

          <WidthControl
            settings={settings}
            video={video}
            onChange={(width) => update({ width })}
          />

          <SliderField
            label="Frame rate"
            value={settings.fps}
            min={5}
            max={30}
            step={1}
            unit=" fps"
            onChange={(fps) => update({ fps })}
            help={settings.fps >= 24 ? "Silky motion, larger file." : "Higher is smoother; lower is lighter."}
          />

          <SliderField
            label="Colors"
            value={settings.colors}
            min={8}
            max={256}
            step={8}
            onChange={(colors) => update({ colors })}
            help={
              settings.colors <= 64
                ? "Compact palette for smaller files."
                : settings.colors >= 200
                  ? "Rich gradients and photographic detail."
                  : "A balanced palette for most clips."
            }
          />

          <div className="field">
            <span className="field-label">Dither</span>
            <Segmented<DitherMode>
              label="Dithering method"
              compact
              value={settings.dither}
              onChange={(dither) => update({ dither })}
              options={[
                { value: "sierra", label: "Sierra" },
                { value: "bayer", label: "Bayer" },
                { value: "none", label: "None" },
              ]}
            />
            <span className="field-help">
              <DitherHelp dither={settings.dither} />
            </span>
          </div>

          <Switch
            checked={settings.optimize}
            onChange={(optimize) => update({ optimize })}
            label="Optimize frame diffs"
            help="Write only the pixels that change between frames."
          />

          <div className="output-specs" aria-label="Output summary">
            <div>
              <span>Output</span>
              <strong>{output ? formatDimensions(output.width, output.height) : "—"}</strong>
            </div>
            <div>
              <span>Length</span>
              <strong>{outDuration > 0 ? formatDuration(outDuration, true) : "—"}</strong>
            </div>
            <div>
              <span>Frames</span>
              <strong>{frameCount > 0 ? frameCount.toLocaleString() : "—"}</strong>
            </div>
          </div>
        </section>

        <section className="inspector-section">
          <SectionHeading eyebrow="Type" title="Title & credit" />

          <div className="field">
            <div className="slider-heading">
              <label className="field-label" htmlFor="title-text">
                Title
              </label>
              <span className="char-count">{settings.titleText.length}/160</span>
            </div>
            <textarea
              id="title-text"
              className="text-input text-area"
              rows={2}
              maxLength={160}
              placeholder="A line worth putting on it"
              value={settings.titleText}
              onChange={(event) => update({ titleText: event.target.value })}
            />
          </div>

          <div className="field">
            <div className="slider-heading">
              <label className="field-label" htmlFor="credit-text">
                Credit
              </label>
              <span className="char-count">{settings.creditText.length}/160</span>
            </div>
            <input
              id="credit-text"
              type="text"
              className="text-input"
              maxLength={160}
              placeholder="Film by…"
              value={settings.creditText}
              onChange={(event) => update({ creditText: event.target.value })}
            />
          </div>

          <div className="field">
            <span className="field-label">Placement</span>
            <Segmented<TitlePosition>
              label="Title placement"
              compact
              value={settings.titlePosition}
              onChange={(titlePosition) => update({ titlePosition })}
              options={[
                { value: "top", label: "Title on top" },
                { value: "bottom", label: "Title below" },
              ]}
            />
          </div>

          <div className="two-up">
            <div className="field">
              <span className="field-label">Typeface</span>
              <Segmented<Typeface>
                label="Typeface"
                compact
                value={settings.typeface}
                onChange={(typeface) => update({ typeface })}
                options={[
                  { value: "sans", label: "Sans" },
                  { value: "serif", label: "Serif" },
                ]}
              />
            </div>
            <div className="field">
              <span className="field-label">Treatment</span>
              <Segmented<TextStyle>
                label="Text treatment"
                compact
                value={settings.textStyle}
                onChange={(textStyle) => update({ textStyle })}
                options={[
                  { value: "shadow", label: "Shadow" },
                  { value: "scrim", label: "Scrim" },
                ]}
              />
            </div>
          </div>

          <SliderField
            label="Text size"
            value={settings.textScale}
            min={50}
            max={160}
            step={5}
            unit="%"
            onChange={(textScale) => update({ textScale })}
            help={
              settings.textStyle === "scrim"
                ? "A soft gradient is added behind the lettering."
                : "A soft drop shadow keeps lettering legible."
            }
          />
          <p className="type-footnote">Text is baked into the GIF at export.</p>
        </section>

        <div className="inspector-end" aria-hidden="true" />
      </div>

      <div className="export-panel">
        <div className="destination-row">
          <button
            type="button"
            className="destination-button"
            onClick={onChooseOutputDir}
            disabled={Boolean(job)}
            title={settings.outputDir ?? "Save next to each source video"}
          >
            <span className="destination-icon">
              <FolderClosed size={15} />
            </span>
            <span className="destination-copy">
              <span>Save to</span>
              <strong>
                {settings.outputDir ? compactPath(settings.outputDir) : "Next to the source clip"}
              </strong>
            </span>
            <ChevronDown size={14} className="destination-chevron" />
          </button>

          {settings.outputDir && (
            <button
              type="button"
              className="destination-clear"
              onClick={onClearOutputDir}
              disabled={Boolean(job)}
              title="Save next to the source clip"
              aria-label="Clear output folder and save next to the source clip"
            >
              <X size={12} />
            </button>
          )}
        </div>

        {job && (
          <div className="export-progress">
            <div className={`export-progress-bar${job.percent === null ? " is-indeterminate" : ""}`}>
              <span style={job.percent === null ? undefined : { width: `${job.percent}%` }} />
            </div>
            <span>{job.message}</span>
          </div>
        )}

        {!job && (
          <div className="export-summary">
            {video && output ? (
              <>
                <span>{formatDimensions(output.width, output.height)}</span>
                <span className="summary-dot" />
                <span>{settings.fps} fps</span>
                <span className="summary-dot" />
                <span>{frameCount.toLocaleString()} frames</span>
              </>
            ) : (
              <span>Bring in a clip to get started.</span>
            )}
          </div>
        )}

        {job ? (
          <button
            type="button"
            className="export-button is-cancel"
            onClick={onCancelExport}
            disabled={job.cancelling}
          >
            {job.cancelling ? (
              <LoaderCircle size={16} className="spin" />
            ) : (
              <X size={16} />
            )}
            {job.cancelling ? "Cancelling…" : "Cancel export"}
          </button>
        ) : (
          <button
            type="button"
            className="export-button"
            onClick={onExport}
            disabled={!canExport}
            title={exportLabel ?? "Export a GIF (⌘⏎)"}
          >
            <Sparkles size={16} />
            <span>Export GIF</span>
            <kbd>⌘⏎</kbd>
          </button>
        )}

        {!job && exportLabel && <span className="export-reason">{exportLabel}</span>}
        {!job && !exportLabel && trimLength <= 0 && (
          <span className="export-reason">Set a valid trim range to export.</span>
        )}
      </div>
    </aside>
  );
}
