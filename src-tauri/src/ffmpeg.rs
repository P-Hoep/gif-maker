use crate::media::{self, MediaTools};
use crate::models::{
    AppSettings, DitherMode, ExportProgress, ExportRequest, ExportResult, PlaybackMode,
};
use crate::overlay;
use std::collections::VecDeque;
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicI32, Ordering};
use std::thread;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

pub const CANCELLED_ERROR: &str = "EXPORT_CANCELLED";

#[derive(Default)]
pub struct ExportState {
    active: AtomicBool,
    cancelled: AtomicBool,
    pid: AtomicI32,
}

impl ExportState {
    fn begin(&self) -> Result<(), String> {
        if self
            .active
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_err()
        {
            return Err("An export is already running.".to_string());
        }
        self.cancelled.store(false, Ordering::SeqCst);
        self.pid.store(0, Ordering::SeqCst);
        Ok(())
    }

    fn finish(&self) {
        self.pid.store(0, Ordering::SeqCst);
        self.active.store(false, Ordering::SeqCst);
    }

    pub fn cancel(&self) {
        self.cancelled.store(true, Ordering::SeqCst);
        let pid = self.pid.load(Ordering::SeqCst);
        if pid > 0 {
            // FFmpeg is a direct child, so a targeted signal is enough.
            unsafe {
                libc::kill(pid, libc::SIGTERM);
            }
        }
    }
}

struct ActiveExport<'a>(&'a ExportState);

impl Drop for ActiveExport<'_> {
    fn drop(&mut self) {
        self.0.finish();
    }
}

pub fn perform_export(
    app: &AppHandle,
    request: &ExportRequest,
) -> Result<ExportResult, String> {
    let state = app.state::<ExportState>();
    state.begin()?;
    let _guard = ActiveExport(&state);

    let tools = media::detect_tools()?;
    let mut emit = |progress: ExportProgress| {
        let _ = app.emit("export-progress", progress);
    };

    run_conversion(&tools, request, &state, &mut emit)
}

pub fn run_conversion(
    tools: &MediaTools,
    request: &ExportRequest,
    state: &ExportState,
    emit: &mut dyn FnMut(ExportProgress),
) -> Result<ExportResult, String> {
    let input = PathBuf::from(&request.input_path);
    if !input.is_file() {
        return Err("The source video no longer exists. Re-import it and try again.".to_string());
    }

    let settings = request.settings.normalized();
    let source = media::probe_video(&input, tools)?;

    let trim_start = if request.trim_start.is_finite() {
        request.trim_start.clamp(0.0, source.duration)
    } else {
        0.0
    };
    let trim_end = request
        .trim_end
        .filter(|value| value.is_finite())
        .unwrap_or(source.duration)
        .clamp(0.0, source.duration);
    if trim_end - trim_start < 0.08 {
        return Err("The selected trim is too short. Choose at least a tenth of a second."
            .to_string());
    }

    let clip_duration = trim_end - trim_start;
    let output_duration = clip_duration
        * if matches!(settings.playback, PlaybackMode::Boomerang) {
            2.0
        } else {
            1.0
        };

    let (out_width, out_height) = output_dimensions(&source, &settings);
    let output_path = unique_output_path(
        &input,
        request.origin_path.as_deref().map(Path::new),
        &settings,
    )?;
    let temp_dir = tempfile::Builder::new()
        .prefix("gifsmith-export-")
        .tempdir()
        .map_err(|error| format!("Couldn't create a working directory: {error}"))?;
    let palette_path = temp_dir.path().join("palette.png");

    let has_text = !settings.title_text.is_empty() || !settings.credit_text.is_empty();
    let overlay_path = if has_text {
        let path = temp_dir.path().join("overlay.png");
        overlay::render_overlay(
            &path,
            out_width,
            out_height,
            &settings.title_text,
            &settings.credit_text,
            settings.title_position,
            settings.text_style,
            settings.typeface,
            settings.text_scale,
        )?;
        Some(path)
    } else {
        None
    };

    progress(
        emit,
        &request.job_id,
        "analyzing",
        None,
        "Building an optimized color palette…",
    );

    let result = (|| -> Result<(), String> {
        // Pass 1: sample every frame and build one palette for the whole clip.
        let (mut palette_graph, palette_base) =
            build_base_graph(&settings, out_width, out_height, overlay_path.as_deref());
        palette_graph.push_str(&format!(
            "[{palette_base}]palettegen=max_colors={}:stats_mode=full:reserve_transparent=0[palette];",
            settings.colors
        ));

        let mut palette_command = Command::new(&tools.ffmpeg);
        add_input_args(
            &mut palette_command,
            &input,
            overlay_path.as_deref(),
            trim_start,
            clip_duration,
        );
        palette_command
            .args(["-filter_complex", &palette_graph])
            .args(["-map", "[palette]"])
            .args(["-frames:v", "1", "-update", "1"])
            .args(["-loglevel", "error", "-nostats"])
            .arg(&palette_path);
        palette_command.stdout(Stdio::null()).stderr(Stdio::piped());

        run_ffmpeg(palette_command, state, None)?;

        if state.cancelled.load(Ordering::SeqCst) {
            return Err(CANCELLED_ERROR.to_string());
        }

        progress(
            emit,
            &request.job_id,
            "rendering",
            Some(45.0),
            "Rendering frames…",
        );

        // Pass 2: map the clip onto the palette and encode the GIF.
        let (mut gif_graph, gif_base) =
            build_base_graph(&settings, out_width, out_height, overlay_path.as_deref());
        let palette_input_index = if overlay_path.is_some() { 2 } else { 1 };
        let mut paletteuse = format!("paletteuse=dither={}", dither_filter(settings.dither));
        if settings.optimize {
            paletteuse.push_str(":diff_mode=rectangle");
        }
        gif_graph.push_str(&format!(
            "[{gif_base}][{palette_input_index}:v]{paletteuse}[out];"
        ));

        let mut gif_command = Command::new(&tools.ffmpeg);
        add_input_args(
            &mut gif_command,
            &input,
            overlay_path.as_deref(),
            trim_start,
            clip_duration,
        );
        gif_command.arg("-i").arg(&palette_path);
        gif_command
            .args(["-filter_complex", &gif_graph])
            .args(["-map", "[out]"])
            .args(["-loop", if settings.loop_forever { "0" } else { "-1" }])
            .args(["-f", "gif"])
            .args(["-loglevel", "error", "-nostats"])
            .args(["-progress", "pipe:1"])
            .arg(&output_path);
        gif_command.stdout(Stdio::piped()).stderr(Stdio::piped());

        let mut last_percent = 44.0_f64;
        let mut last_emitted = Instant::now() - Duration::from_secs(1);
        let mut on_progress = |seconds: f64| {
            let ratio = (seconds / output_duration.max(0.01)).clamp(0.0, 1.0);
            let percent = 45.0 + ratio * 52.0;
            if percent - last_percent >= 0.5 || last_emitted.elapsed() > Duration::from_secs(1) {
                last_percent = percent;
                last_emitted = Instant::now();
                progress(
                    emit,
                    &request.job_id,
                    "rendering",
                    Some(percent),
                    "Rendering frames…",
                );
            }
        };

        run_ffmpeg(gif_command, state, Some(&mut on_progress))?;

        Ok(())
    })();

    if let Err(error) = result {
        let _ = fs::remove_file(&output_path);
        return Err(error);
    }

    let metadata = fs::metadata(&output_path).map_err(|error| {
        let _ = fs::remove_file(&output_path);
        format!("The GIF was rendered but couldn't be read: {error}")
    })?;
    if metadata.len() == 0 {
        let _ = fs::remove_file(&output_path);
        return Err("FFmpeg produced an empty GIF.".to_string());
    }

    progress(
        emit,
        &request.job_id,
        "finalizing",
        Some(99.0),
        "Finishing up…",
    );

    let result = ExportResult {
        output_path: output_path.to_string_lossy().to_string(),
        file_name: output_path
            .file_name()
            .map(|name| name.to_string_lossy().to_string())
            .unwrap_or_else(|| "clip.gif".to_string()),
        file_size: metadata.len(),
        width: out_width,
        height: out_height,
        duration: output_duration,
        frame_count: ((output_duration * settings.fps as f64).round() as u32).max(1),
    };

    progress(
        emit,
        &request.job_id,
        "done",
        Some(100.0),
        "GIF ready",
    );

    Ok(result)
}

fn progress(
    emit: &mut dyn FnMut(ExportProgress),
    job_id: &str,
    stage: &str,
    percent: Option<f64>,
    message: &str,
) {
    emit(ExportProgress {
        job_id: job_id.to_string(),
        stage: stage.to_string(),
        percent,
        message: message.to_string(),
    });
}

fn dither_filter(dither: DitherMode) -> &'static str {
    match dither {
        DitherMode::Sierra => "sierra2_4a",
        DitherMode::Bayer => "bayer:bayer_scale=3",
        DitherMode::None => "none",
    }
}

fn build_base_graph(
    settings: &AppSettings,
    width: u32,
    height: u32,
    overlay: Option<&Path>,
) -> (String, &'static str) {
    let mut graph = format!(
        "[0:v]fps={},scale={width}:{height}:flags=lanczos,setsar=1[v0];",
        settings.fps
    );
    let mut label = "v0";

    match settings.playback {
        PlaybackMode::Forward => {}
        PlaybackMode::Reverse => {
            graph.push_str("[v0]reverse[v1];");
            label = "v1";
        }
        PlaybackMode::Boomerang => {
            graph.push_str(
                "[v0]split[forward][backward];[backward]reverse[reversed];\
                 [forward][reversed]concat=n=2:v=1:a=0[v1];",
            );
            label = "v1";
        }
    }

    if overlay.is_some() {
        if label == "v0" {
            graph.push_str(
                "[v0][1:v]overlay=0:0:format=auto:eof_action=repeat:shortest=0[v2];",
            );
        } else {
            graph.push_str(
                "[v1][1:v]overlay=0:0:format=auto:eof_action=repeat:shortest=0[v2];",
            );
        }
        label = "v2";
    }

    (graph, label)
}

fn add_input_args(
    command: &mut Command,
    input: &Path,
    overlay: Option<&Path>,
    trim_start: f64,
    clip_duration: f64,
) {
    command.args([
        "-hide_banner",
        "-nostdin",
        "-y",
        "-ss",
        &format!("{trim_start:.6}"),
        "-t",
        &format!("{clip_duration:.6}"),
        "-i",
    ]);
    command.arg(input);
    if let Some(overlay) = overlay {
        command.arg("-i").arg(overlay);
    }
}

fn run_ffmpeg(
    mut command: Command,
    state: &ExportState,
    mut on_progress: Option<&mut dyn FnMut(f64)>,
) -> Result<(), String> {
    if on_progress.is_none() {
        command.stdout(Stdio::null());
    }
    command.stderr(Stdio::piped());

    let mut child = command
        .spawn()
        .map_err(|error| format!("Couldn't launch FFmpeg: {error}"))?;
    state.pid.store(child.id() as i32, Ordering::SeqCst);

    let stdout = child.stdout.take();
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "Couldn't read FFmpeg output.".to_string())?;

    let stderr_thread = thread::spawn(move || {
        let mut lines: VecDeque<String> = VecDeque::new();
        for line in BufReader::new(stderr).lines().map_while(Result::ok) {
            if line.trim().is_empty() {
                continue;
            }
            lines.push_back(line);
            if lines.len() > 16 {
                lines.pop_front();
            }
        }
        lines
    });

    if let (Some(stdout), Some(callback)) = (stdout, on_progress.as_mut()) {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            let Some(value) = line.strip_prefix("out_time_us=") else {
                continue;
            };
            let Ok(microseconds) = value.trim().parse::<i64>() else {
                continue;
            };
            if microseconds >= 0 {
                callback(microseconds as f64 / 1_000_000.0);
            }
        }
    }

    let status = child.wait();
    state.pid.store(0, Ordering::SeqCst);
    let stderr_lines = stderr_thread.join().unwrap_or_default();

    if state.cancelled.load(Ordering::SeqCst) {
        return Err(CANCELLED_ERROR.to_string());
    }

    let status = status.map_err(|error| format!("FFmpeg stopped unexpectedly: {error}"))?;
    if !status.success() {
        let tail = stderr_lines
            .iter()
            .rev()
            .take(8)
            .map(String::as_str)
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect::<Vec<_>>()
            .join("\n");
        let detail = if tail.is_empty() {
            "no error details were returned".to_string()
        } else {
            tail
        };
        return Err(format!("FFmpeg couldn't make the GIF.\n{detail}"));
    }

    Ok(())
}

/// Picks the output path. `origin` is the original GIF when the clip was
/// converted from one, so exports keep the GIF's name and folder rather than
/// the temporary working copy's.
fn unique_output_path(
    input: &Path,
    origin: Option<&Path>,
    settings: &AppSettings,
) -> Result<PathBuf, String> {
    let naming_source = origin.unwrap_or(input);
    let output_dir = settings
        .output_dir
        .as_ref()
        .map(PathBuf::from)
        .or_else(|| naming_source.parent().map(Path::to_path_buf))
        .unwrap_or_else(|| PathBuf::from("."));

    fs::create_dir_all(&output_dir)
        .map_err(|error| format!("Couldn't open the output folder: {error}"))?;

    let stem = safe_stem(naming_source);
    let mut candidate = output_dir.join(format!("{stem}.gif"));
    let mut index = 2;
    while candidate.exists() {
        candidate = output_dir.join(format!("{stem} {index}.gif"));
        index += 1;
        if index > 999 {
            return Err("Couldn't find an available file name in the output folder.".to_string());
        }
    }
    Ok(candidate)
}

fn safe_stem(path: &Path) -> String {
    let raw = path
        .file_stem()
        .map(|stem| stem.to_string_lossy().to_string())
        .unwrap_or_else(|| "clip".to_string());
    let cleaned: String = raw
        .chars()
        .map(|ch| match ch {
            '/' | ':' | '\0' => '-',
            other => other,
        })
        .take(100)
        .collect();
    let trimmed = cleaned.trim_matches(|ch: char| ch.is_whitespace() || ch == '.');
    if trimmed.is_empty() {
        "clip".to_string()
    } else {
        trimmed.to_string()
    }
}

fn output_dimensions(source: &crate::models::VideoMeta, settings: &AppSettings) -> (u32, u32) {
    let source_width = source.width.max(2);
    let source_height = source.height.max(2);
    let desired = if settings.width == 0 {
        source_width
    } else {
        settings.width.min(source_width)
    };
    let width = desired.clamp(2, 1600).min(source_width).max(2);
    let height = ((width as f64 * source_height as f64 / source_width as f64)
        .round()
        .max(2.0)) as u32;
    (width, height.min(3200))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::TitlePosition;
    use std::process::Stdio;

    fn test_settings(output_dir: PathBuf) -> AppSettings {
        AppSettings {
            playback: PlaybackMode::Boomerang,
            width: 320,
            fps: 12,
            colors: 64,
            dither: DitherMode::Sierra,
            loop_forever: true,
            optimize: true,
            title_text: "Made with Gifsmith".to_string(),
            credit_text: "A test clip".to_string(),
            title_position: TitlePosition::Top,
            text_style: crate::models::TextStyle::Shadow,
            typeface: crate::models::Typeface::Sans,
            text_scale: 100,
            output_dir: Some(output_dir.to_string_lossy().to_string()),
        }
    }

    #[test]
    fn generates_a_boomerang_gif() {
        let tools = match media::detect_tools() {
            Ok(tools) => tools,
            Err(_) => return,
        };

        let dir = tempfile::tempdir().expect("tempdir");
        let source = dir.path().join("source.mp4");
        let status = Command::new(&tools.ffmpeg)
            .args([
                "-hide_banner",
                "-loglevel",
                "error",
                "-y",
                "-f",
                "lavfi",
                "-i",
                "testsrc2=size=480x270:rate=24:duration=1.2",
                "-c:v",
                "libx264",
                "-pix_fmt",
                "yuv420p",
            ])
            .arg(&source)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .expect("create source");
        assert!(status.success());

        let output_dir = dir.path().join("out");
        let request = ExportRequest {
            job_id: "test".to_string(),
            input_path: source.to_string_lossy().to_string(),
            trim_start: 0.1,
            trim_end: Some(1.0),
            origin_path: None,
            settings: test_settings(output_dir),
        };
        let state = ExportState::default();
        let mut events = Vec::new();
        let result = run_conversion(&tools, &request, &state, &mut |event| events.push(event))
            .expect("conversion");

        assert!(Path::new(&result.output_path).is_file());
        assert!(result.file_size > 1_000);
        assert_eq!(result.width, 320);
        assert_eq!(result.height, 180);
        assert!((result.duration - 1.8).abs() < 0.001);
        assert!(events.iter().any(|event| event.stage == "done"));
    }
}
