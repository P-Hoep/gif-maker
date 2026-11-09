use crate::models::{ImportOutcome, ToolsStatus, VideoAsset, VideoMeta};
use base64::Engine as _;
use serde::Deserialize;
use serde_json::Value;
use std::collections::HashSet;
use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use walkdir::WalkDir;

const VIDEO_EXTENSIONS: &[&str] = &[
    "mp4", "m4v", "mov", "qt", "mkv", "webm", "avi", "mpg", "mpeg", "m2v", "wmv", "flv", "3gp",
    "3g2", "mts", "m2ts", "ts", "ogv", "asf", "vob", "f4v",
];

const MAX_IMPORTED_VIDEOS: usize = 500;

#[derive(Debug, Clone)]
pub struct MediaTools {
    pub ffmpeg: PathBuf,
    pub ffprobe: PathBuf,
}

pub fn is_video_path(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| VIDEO_EXTENSIONS.contains(&ext.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}

fn is_hidden_dir(path: &Path) -> bool {
    path.file_name()
        .and_then(|name| name.to_str())
        .map(|name| name.starts_with('.'))
        .unwrap_or(false)
}

fn executable_candidates(name: &str) -> Vec<PathBuf> {
    let mut candidates = Vec::new();

    let env_key = if name == "ffmpeg" {
        "FFMPEG_PATH"
    } else {
        "FFPROBE_PATH"
    };
    if let Some(value) = env::var_os(env_key) {
        let path = PathBuf::from(value);
        if path.is_file() {
            candidates.push(path);
        }
    }

    if let Some(path_var) = env::var_os("PATH") {
        for dir in env::split_paths(&path_var) {
            let candidate = dir.join(name);
            if candidate.is_file() {
                candidates.push(candidate);
            }
        }
    }

    for dir in [
        "/opt/homebrew/bin",
        "/usr/local/bin",
        "/opt/local/bin",
        "/usr/bin",
    ] {
        let candidate = Path::new(dir).join(name);
        if candidate.is_file() {
            candidates.push(candidate);
        }
    }

    candidates
}

fn locate_binary(name: &str) -> Option<PathBuf> {
    executable_candidates(name)
        .into_iter()
        .find(|path| binary_version(path).is_some())
}

fn binary_version(path: &Path) -> Option<String> {
    let output = Command::new(path)
        .arg("-version")
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&output.stdout);
    let line = text.lines().next()?.trim();
    if line.is_empty() {
        None
    } else {
        Some(line.to_string())
    }
}

fn short_version(version_line: &str) -> String {
    // "ffmpeg version 7.1 Copyright ..." -> "7.1"
    version_line
        .split_whitespace()
        .nth(2)
        .unwrap_or(version_line)
        .to_string()
}

pub fn tools_status() -> ToolsStatus {
    let ffmpeg = locate_binary("ffmpeg");
    let ffprobe = locate_binary("ffprobe");

    let mut status = ToolsStatus {
        available: false,
        version: None,
        ffmpeg_path: ffmpeg
            .as_ref()
            .map(|path| path.to_string_lossy().to_string()),
        ffprobe_path: ffprobe
            .as_ref()
            .map(|path| path.to_string_lossy().to_string()),
        error: None,
    };

    match (ffmpeg, ffprobe) {
        (Some(ffmpeg), Some(ffprobe)) => {
            if let Some(version_line) = binary_version(&ffmpeg) {
                status.available = true;
                status.version = Some(short_version(&version_line));
            } else {
                status.error = Some("FFmpeg was found but could not be started.".to_string());
            }
            let _ = ffprobe;
        }
        (None, _) => {
            status.error = Some(
                "FFmpeg is not installed. Install it with Homebrew using `brew install ffmpeg`, then click Retry."
                    .to_string(),
            );
        }
        (_, None) => {
            status.error = Some(
                "FFprobe is missing. Reinstall FFmpeg with `brew install ffmpeg`, then click Retry."
                    .to_string(),
            );
        }
    }

    status
}

pub fn detect_tools() -> Result<MediaTools, String> {
    let status = tools_status();
    if !status.available {
        return Err(status
            .error
            .unwrap_or_else(|| "FFmpeg is unavailable.".to_string()));
    }

    Ok(MediaTools {
        ffmpeg: PathBuf::from(
            status
                .ffmpeg_path
                .ok_or_else(|| "FFmpeg path is unavailable.".to_string())?,
        ),
        ffprobe: PathBuf::from(
            status
                .ffprobe_path
                .ok_or_else(|| "FFprobe path is unavailable.".to_string())?,
        ),
    })
}

fn collect_videos(
    inputs: &[String],
) -> (Vec<PathBuf>, Vec<String>) {
    let mut files = Vec::new();
    let mut errors = Vec::new();
    let mut seen = HashSet::new();
    let mut limit_reached = false;

    for raw in inputs {
        let path = PathBuf::from(raw);
        if !path.exists() {
            errors.push(format!("Couldn't find {}", path.display()));
            continue;
        }

        if path.is_dir() {
            let walker = WalkDir::new(&path)
                .max_depth(8)
                .follow_links(false)
                .sort_by_file_name()
                .into_iter()
                .filter_entry(|entry| {
                    entry.depth() == 0 || !is_hidden_dir(entry.path())
                });

            for entry in walker.filter_map(Result::ok) {
                if !entry.file_type().is_file() || !is_video_path(entry.path()) {
                    continue;
                }
                if files.len() >= MAX_IMPORTED_VIDEOS {
                    limit_reached = true;
                    break;
                }
                let canonical = fs::canonicalize(entry.path()).unwrap_or_else(|_| entry.into_path());
                if seen.insert(canonical.clone()) {
                    files.push(canonical);
                }
            }
        } else if is_video_path(&path) {
            let canonical = fs::canonicalize(&path).unwrap_or(path);
            if seen.insert(canonical.clone()) {
                files.push(canonical);
            }
        } else {
            errors.push(format!(
                "Skipped {} — it isn't a supported video file.",
                path.file_name()
                    .map(|name| name.to_string_lossy().to_string())
                    .unwrap_or_else(|| path.to_string_lossy().to_string())
            ));
        }

        if limit_reached {
            break;
        }
    }

    if limit_reached {
        errors.push(format!(
            "Only the first {MAX_IMPORTED_VIDEOS} videos were added. Import a smaller folder to see the rest."
        ));
    }

    (files, errors)
}

pub fn import_paths(paths: &[String]) -> Result<ImportOutcome, String> {
    if paths.is_empty() {
        return Ok(ImportOutcome {
            videos: Vec::new(),
            errors: Vec::new(),
        });
    }

    let tools = detect_tools()?;
    let (files, mut errors) = collect_videos(paths);

    let mut videos = Vec::new();
    for file in files {
        match probe_video(&file, &tools) {
            Ok(meta) => {
                let thumbnail = make_thumbnail(&file, &tools, meta.duration);
                let file_name = file
                    .file_name()
                    .map(|name| name.to_string_lossy().to_string())
                    .unwrap_or_else(|| "Untitled".to_string());
                let name = file
                    .file_stem()
                    .map(|name| name.to_string_lossy().to_string())
                    .unwrap_or_else(|| file_name.clone());
                let extension = file
                    .extension()
                    .and_then(|ext| ext.to_str())
                    .unwrap_or("")
                    .to_ascii_uppercase();

                videos.push(VideoAsset {
                    path: file.to_string_lossy().to_string(),
                    name,
                    file_name,
                    extension,
                    duration: meta.duration,
                    width: meta.width,
                    height: meta.height,
                    fps: meta.fps,
                    codec: meta.codec,
                    file_size: meta.file_size,
                    thumbnail,
                });
            }
            Err(error) => errors.push(error),
        }
    }

    Ok(ImportOutcome { videos, errors })
}

fn make_thumbnail(path: &Path, tools: &MediaTools, duration: f64) -> Option<String> {
    let seek = (duration * 0.08)
        .clamp(0.0, 1.0)
        .min((duration - 0.05).max(0.0));

    let mut command = Command::new(&tools.ffmpeg);
    command.args([
        "-hide_banner",
        "-nostdin",
        "-loglevel",
        "error",
    ]);
    if seek > 0.01 {
        command.args(["-ss", &format!("{seek:.3}")]);
    }
    command.args([
        "-i",
        &path.to_string_lossy(),
        "-frames:v",
        "1",
        "-vf",
        "scale=480:-2:flags=lanczos",
        "-an",
        "-f",
        "image2pipe",
        "-vcodec",
        "mjpeg",
        "-q:v",
        "5",
        "-",
    ]);
    command.stdout(Stdio::piped()).stderr(Stdio::null());

    let output = command.output().ok()?;
    if !output.status.success() || output.stdout.is_empty() {
        return None;
    }

    let encoded = base64::engine::general_purpose::STANDARD.encode(output.stdout);
    Some(format!("data:image/jpeg;base64,{encoded}"))
}

pub fn probe_video(path: &Path, tools: &MediaTools) -> Result<VideoMeta, String> {
    let display_name = path
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_else(|| path.to_string_lossy().to_string());

    let output = Command::new(&tools.ffprobe)
        .args([
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_streams",
            "-show_format",
            "-of",
            "json",
        ])
        .arg(path)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .map_err(|error| format!("Couldn't inspect {display_name}: {error}"))?;

    if !output.status.success() {
        let detail = String::from_utf8_lossy(&output.stderr);
        let reason = detail
            .lines()
            .rev()
            .find(|line| !line.trim().is_empty())
            .unwrap_or("the file could not be decoded")
            .trim();
        return Err(format!("Couldn't read {display_name}: {reason}"));
    }

    let parsed: ProbeOutput = serde_json::from_slice(&output.stdout)
        .map_err(|_| format!("Couldn't read metadata for {display_name}."))?;
    let stream = parsed
        .streams
        .as_ref()
        .and_then(|streams| streams.first())
        .ok_or_else(|| format!("{display_name} doesn't contain a video track."))?;

    let mut width = stream.width.unwrap_or(0);
    let mut height = stream.height.unwrap_or(0);
    if width == 0 || height == 0 {
        return Err(format!("Couldn't determine the size of {display_name}."));
    }

    let rotation = stream
        .tags
        .as_ref()
        .and_then(|tags| tags.get("rotate"))
        .and_then(value_as_f64)
        .or_else(|| {
            stream.side_data_list.as_ref().and_then(|items| {
                items
                    .iter()
                    .find_map(|item| item.get("rotation").and_then(value_as_f64))
            })
        })
        .unwrap_or(0.0);
    let normalized_rotation = rotation.rem_euclid(360.0).round() as i64;
    if normalized_rotation == 90 || normalized_rotation == 270 {
        std::mem::swap(&mut width, &mut height);
    }

    let duration = stream
        .duration
        .as_deref()
        .and_then(parse_f64)
        .or_else(|| {
            parsed
                .format
                .as_ref()
                .and_then(|format| format.duration.as_deref())
                .and_then(parse_f64)
        })
        .filter(|value| *value > 0.0)
        .ok_or_else(|| format!("Couldn't determine the duration of {display_name}."))?;

    let fps = stream
        .avg_frame_rate
        .as_deref()
        .and_then(parse_frame_rate)
        .filter(|value| *value > 0.0)
        .or_else(|| {
            stream
                .r_frame_rate
                .as_deref()
                .and_then(parse_frame_rate)
                .filter(|value| *value > 0.0)
        })
        .unwrap_or(30.0);

    let file_size = parsed
        .format
        .as_ref()
        .and_then(|format| format.size.as_deref())
        .and_then(parse_u64)
        .or_else(|| fs::metadata(path).ok().map(|meta| meta.len()))
        .unwrap_or(0);

    Ok(VideoMeta {
        duration,
        width,
        height,
        fps,
        codec: stream
            .codec_name
            .as_deref()
            .unwrap_or("video")
            .to_ascii_uppercase(),
        file_size,
    })
}

fn parse_f64(value: &str) -> Option<f64> {
    value.trim().parse::<f64>().ok()
}

fn value_as_f64(value: &Value) -> Option<f64> {
    value
        .as_f64()
        .or_else(|| value.as_str().and_then(parse_f64))
}

fn parse_u64(value: &str) -> Option<u64> {
    value.trim().parse::<u64>().ok()
}

fn parse_frame_rate(value: &str) -> Option<f64> {
    let (num, den) = value.split_once('/')?;
    let num = num.parse::<f64>().ok()?;
    let den = den.parse::<f64>().ok()?;
    if den == 0.0 {
        None
    } else {
        Some(num / den)
    }
}

#[derive(Debug, Deserialize)]
struct ProbeOutput {
    streams: Option<Vec<ProbeStream>>,
    format: Option<ProbeFormat>,
}

#[derive(Debug, Deserialize)]
struct ProbeStream {
    width: Option<u32>,
    height: Option<u32>,
    avg_frame_rate: Option<String>,
    r_frame_rate: Option<String>,
    duration: Option<String>,
    codec_name: Option<String>,
    tags: Option<Value>,
    side_data_list: Option<Vec<Value>>,
}

#[derive(Debug, Deserialize)]
struct ProbeFormat {
    duration: Option<String>,
    size: Option<String>,
}
