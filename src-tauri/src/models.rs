use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoAsset {
    pub path: String,
    pub name: String,
    pub file_name: String,
    pub extension: String,
    pub duration: f64,
    pub width: u32,
    pub height: u32,
    pub fps: f64,
    pub codec: String,
    pub file_size: u64,
    pub thumbnail: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportOutcome {
    pub videos: Vec<VideoAsset>,
    pub errors: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolsStatus {
    pub available: bool,
    pub version: Option<String>,
    pub ffmpeg_path: Option<String>,
    pub ffprobe_path: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum PlaybackMode {
    Forward,
    Reverse,
    Boomerang,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum DitherMode {
    Sierra,
    Bayer,
    None,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum TitlePosition {
    Top,
    Bottom,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum TextStyle {
    Shadow,
    Scrim,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Typeface {
    Sans,
    Serif,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AppSettings {
    pub playback: PlaybackMode,
    pub width: u32,
    pub fps: u32,
    pub colors: u32,
    pub dither: DitherMode,
    pub loop_forever: bool,
    pub optimize: bool,
    pub title_text: String,
    pub credit_text: String,
    pub title_position: TitlePosition,
    pub text_style: TextStyle,
    pub typeface: Typeface,
    pub text_scale: u32,
    pub output_dir: Option<String>,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            playback: PlaybackMode::Forward,
            width: 640,
            fps: 15,
            colors: 160,
            dither: DitherMode::Sierra,
            loop_forever: true,
            optimize: true,
            title_text: String::new(),
            credit_text: String::new(),
            title_position: TitlePosition::Top,
            text_style: TextStyle::Shadow,
            typeface: Typeface::Sans,
            text_scale: 100,
            output_dir: None,
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportRequest {
    pub job_id: String,
    pub input_path: String,
    #[serde(default)]
    pub trim_start: f64,
    #[serde(default)]
    pub trim_end: Option<f64>,
    pub settings: AppSettings,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportProgress {
    pub job_id: String,
    pub stage: String,
    pub percent: Option<f64>,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportResult {
    pub output_path: String,
    pub file_name: String,
    pub file_size: u64,
    pub width: u32,
    pub height: u32,
    pub duration: f64,
    pub frame_count: u32,
}

/// The internal result of `ffprobe`. Dimensions are already rotation-corrected.
#[derive(Debug, Clone)]
pub struct VideoMeta {
    pub duration: f64,
    pub width: u32,
    pub height: u32,
    pub fps: f64,
    pub codec: String,
    pub file_size: u64,
}

impl AppSettings {
    pub fn normalized(&self) -> AppSettings {
        let mut s = self.clone();
        s.width = s.width.clamp(0, 1600);
        s.fps = s.fps.clamp(5, 30);
        s.colors = s.colors.clamp(8, 256);
        s.text_scale = s.text_scale.clamp(50, 160);
        s.title_text = limit_chars(s.title_text.trim(), 160);
        s.credit_text = limit_chars(s.credit_text.trim(), 160);
        s.output_dir = s
            .output_dir
            .as_deref()
            .map(str::trim)
            .filter(|v| !v.is_empty())
            .map(ToOwned::to_owned);
        s
    }
}

fn limit_chars(value: &str, max_chars: usize) -> String {
    value.chars().take(max_chars).collect()
}
