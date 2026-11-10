use crate::models::{ImportOutcome, ToolsStatus, VideoAsset, VideoMeta};
use base64::Engine as _;
use serde::Deserialize;
use serde_json::Value;
use std::collections::HashSet;
use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, SystemTime};
use walkdir::WalkDir;

const VIDEO_EXTENSIONS: &[&str] = &[
    "mp4", "m4v", "mov", "qt", "mkv", "webm", "avi", "mpg", "mpeg", "m2v", "wmv", "flv", "3gp",
    "3g2", "mts", "m2ts", "ts", "ogv", "asf", "vob", "f4v",
];

const GIF_EXTENSIONS: &[&str] = &["gif"];

const MAX_IMPORTED_VIDEOS: usize = 500;

/// Converted GIFs live here so they survive for as long as the app is open.
const IMPORT_CACHE_MAX_AGE: Duration = Duration::from_secs(7 * 24 * 60 * 60);

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

pub fn is_gif_path(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| GIF_EXTENSIONS.contains(&ext.to_ascii_lowercase().as_str()))
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
                    origin_path: None,
                });
            }
            Err(error) => errors.push(error),
        }
    }

    Ok(ImportOutcome { videos, errors })
}

/// Imports GIFs by converting each one to an intermediate H.264 clip in
/// `cache_root`, so the rest of the pipeline — preview, trim, playback modes,
/// overlays, and export — can treat it like any other video.
pub fn import_gif_paths(paths: &[String], cache_root: &Path) -> Result<ImportOutcome, String> {
    if paths.is_empty() {
        return Ok(ImportOutcome {
            videos: Vec::new(),
            errors: Vec::new(),
        });
    }

    let tools = detect_tools()?;
    fs::create_dir_all(cache_root)
        .map_err(|error| format!("Couldn't prepare a workspace for GIF imports: {error}"))?;
    prune_import_cache(cache_root);

    let mut videos = Vec::new();
    let mut errors = Vec::new();
    let mut seen = HashSet::new();

    for raw in paths {
        let path = PathBuf::from(raw);
        let display_name = path
            .file_name()
            .map(|name| name.to_string_lossy().to_string())
            .unwrap_or_else(|| path.to_string_lossy().to_string());

        if !path.exists() {
            errors.push(format!("Couldn't find {}", path.display()));
            continue;
        }
        if !path.is_file() || !is_gif_path(&path) {
            errors.push(format!("Skipped {display_name} — it isn't a GIF file."));
            continue;
        }

        let canonical = fs::canonicalize(&path).unwrap_or(path);
        if !seen.insert(canonical.clone()) {
            continue;
        }

        match import_single_gif(&canonical, &tools, cache_root) {
            Ok(video) => videos.push(video),
            Err(error) => errors.push(error),
        }
    }

    Ok(ImportOutcome { videos, errors })
}

fn import_single_gif(
    path: &Path,
    tools: &MediaTools,
    cache_root: &Path,
) -> Result<VideoAsset, String> {
    let file_name = path
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_else(|| "Untitled.gif".to_string());
    let name = path
        .file_stem()
        .map(|stem| stem.to_string_lossy().to_string())
        .unwrap_or_else(|| file_name.clone());
    let metadata = fs::metadata(path)
        .map_err(|error| format!("Couldn't read {file_name}: {error}"))?;

    let converted = converted_gif_path(path, &metadata, cache_root);
    if !converted.is_file() {
        convert_gif_to_video(path, &converted, tools, &file_name)?;
    }

    let meta = probe_video(&converted, tools)?;
    let thumbnail = make_thumbnail(&converted, tools, meta.duration);

    Ok(VideoAsset {
        path: converted.to_string_lossy().to_string(),
        name,
        file_name,
        extension: "GIF".to_string(),
        duration: meta.duration,
        width: meta.width,
        height: meta.height,
        fps: meta.fps,
        codec: "GIF".to_string(),
        file_size: metadata.len(),
        thumbnail,
        origin_path: Some(path.to_string_lossy().to_string()),
    })
}

/// A stable cache path for a GIF. Changing the source file (mtime or size)
/// yields a different path, so an old conversion is never mistaken for a new one.
fn converted_gif_path(source: &Path, metadata: &fs::Metadata, cache_root: &Path) -> PathBuf {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};

    let mut hasher = DefaultHasher::new();
    source.to_string_lossy().hash(&mut hasher);
    metadata.len().hash(&mut hasher);
    if let Some(modified) = metadata.modified().ok() {
        if let Ok(stamp) = modified.duration_since(SystemTime::UNIX_EPOCH) {
            stamp.as_nanos().hash(&mut hasher);
        }
    }

    cache_root.join(format!("{}-{:016x}.mp4", cache_stem(source), hasher.finish()))
}

fn cache_stem(path: &Path) -> String {
    let raw = path
        .file_stem()
        .map(|stem| stem.to_string_lossy().to_string())
        .unwrap_or_else(|| "gif".to_string());
    let cleaned: String = raw
        .chars()
        .map(|ch| match ch {
            '/' | ':' | '\0' => '-',
            other => other,
        })
        .take(80)
        .collect();
    let trimmed = cleaned.trim_matches(|ch: char| ch.is_whitespace() || ch == '.');
    if trimmed.is_empty() {
        "gif".to_string()
    } else {
        trimmed.to_string()
    }
}

fn convert_gif_to_video(
    source: &Path,
    destination: &Path,
    tools: &MediaTools,
    display_name: &str,
) -> Result<(), String> {
    let partial = destination.with_extension("part.mp4");
    let _ = fs::remove_file(&partial);

    let output = Command::new(&tools.ffmpeg)
        .args(["-hide_banner", "-nostdin", "-y", "-loglevel", "error", "-i"])
        .arg(source)
        .args([
            // yuv420p needs even dimensions; GIFs are often odd-sized.
            "-vf",
            "scale=trunc(iw/2)*2:trunc(ih/2)*2:flags=lanczos",
            "-an",
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-crf",
            "12",
            "-pix_fmt",
            "yuv420p",
            "-movflags",
            "+faststart",
        ])
        .arg(&partial)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .output()
        .map_err(|error| format!("Couldn't launch FFmpeg to read {display_name}: {error}"))?;

    if !output.status.success() {
        let _ = fs::remove_file(&partial);
        let detail = String::from_utf8_lossy(&output.stderr);
        let reason = detail
            .lines()
            .rev()
            .find(|line| !line.trim().is_empty())
            .unwrap_or("the file could not be decoded")
            .trim()
            .to_string();
        return Err(format!("Couldn't convert {display_name}: {reason}"));
    }

    fs::rename(&partial, destination).map_err(|error| {
        let _ = fs::remove_file(&partial);
        format!("Couldn't finish converting {display_name}: {error}")
    })
}

fn prune_import_cache(cache_root: &Path) {
    let Ok(entries) = fs::read_dir(cache_root) else {
        return;
    };
    let now = SystemTime::now();
    for entry in entries.flatten() {
        let Ok(metadata) = entry.metadata() else {
            continue;
        };
        if !metadata.is_file() {
            continue;
        }
        let Ok(modified) = metadata.modified() else {
            continue;
        };
        if now
            .duration_since(modified)
            .map(|age| age > IMPORT_CACHE_MAX_AGE)
            .unwrap_or(false)
        {
            let _ = fs::remove_file(entry.path());
        }
    }
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn converts_a_gif_into_an_editable_clip() {
        let tools = match detect_tools() {
            Ok(tools) => tools,
            Err(_) => return,
        };

        let dir = tempfile::tempdir().expect("tempdir");
        let gif = dir.path().join("loop.gif");
        let status = Command::new(&tools.ffmpeg)
            .args([
                "-hide_banner",
                "-loglevel",
                "error",
                "-y",
                "-f",
                "lavfi",
                "-i",
                "testsrc2=size=128x96:rate=10:duration=1.2",
            ])
            .arg(&gif)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .expect("create gif");
        assert!(status.success());

        let cache = dir.path().join("cache");
        let outcome = import_gif_paths(&[gif.to_string_lossy().to_string()], &cache)
            .expect("import gif");

        assert!(outcome.errors.is_empty(), "{:?}", outcome.errors);
        assert_eq!(outcome.videos.len(), 1);

        let video = &outcome.videos[0];
        assert_eq!(video.file_name, "loop.gif");
        assert_eq!(video.extension, "GIF");
        assert_eq!(video.width, 128);
        assert_eq!(video.height, 96);
        assert!(video.duration > 1.0);
        assert!(Path::new(&video.path).is_file());
        assert!(video.path.ends_with(".mp4"));
        assert_eq!(
            video.origin_path.as_deref().and_then(|path| Path::new(path).file_name()),
            gif.file_name()
        );

        // A second import reuses the cached conversion instead of making a new one.
        let again = import_gif_paths(&[gif.to_string_lossy().to_string()], &cache)
            .expect("import gif again");
        assert_eq!(again.videos[0].path, video.path);
    }

    #[test]
    fn rejects_non_gif_imports() {
        if detect_tools().is_err() {
            return;
        }

        let dir = tempfile::tempdir().expect("tempdir");
        let text = dir.path().join("notes.txt");
        fs::write(&text, "not a gif").expect("write file");

        let outcome = import_gif_paths(&[text.to_string_lossy().to_string()], dir.path())
            .expect("import");
        assert!(outcome.videos.is_empty());
        assert_eq!(outcome.errors.len(), 1);
    }
}
