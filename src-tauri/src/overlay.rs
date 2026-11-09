use crate::models::{TextStyle, TitlePosition, Typeface};
use ab_glyph::{FontArc, PxScale};
use image::{ImageFormat, Rgba, RgbaImage};
use imageproc::drawing::{draw_text_mut, text_size};
use std::path::{Path, PathBuf};

struct FontPair {
    bold: FontArc,
    regular: FontArc,
}

struct TextLine {
    text: String,
    x: i32,
    y: i32,
    size: f32,
    font: FontArc,
    color: Rgba<u8>,
}

/// Renders a transparent title/credit card sized exactly to the output GIF.
pub fn render_overlay(
    destination: &Path,
    width: u32,
    height: u32,
    title: &str,
    credit: &str,
    title_position: TitlePosition,
    text_style: TextStyle,
    typeface: Typeface,
    text_scale: u32,
) -> Result<(), String> {
    let width = width.max(2);
    let height = height.max(2);
    let mut canvas = RgbaImage::new(width, height);
    let fonts = load_fonts(typeface)?;

    let scale = text_scale as f32 / 100.0;
    let margin_x = (width as f32 * 0.065).clamp(10.0, 96.0);
    let margin_y = (height as f32 * 0.06).clamp(8.0, 72.0);
    let max_text_width = (width as f32 - margin_x * 2.0).max(40.0);

    let title_text = title.trim();
    let credit_text = credit.trim();

    let title_size = (height as f32 * 0.083 * scale).clamp(9.0, 150.0);
    let credit_size = (height as f32 * 0.039 * scale).clamp(7.5, 64.0);

    let mut title_block = None;
    let mut credit_block = None;

    if !title_text.is_empty() {
        let (lines, size) = fit_lines(&fonts.bold, title_text, title_size, max_text_width, 3);
        if !lines.is_empty() {
            title_block = Some((lines, size));
        }
    }
    if !credit_text.is_empty() {
        let (lines, size) =
            fit_lines(&fonts.regular, credit_text, credit_size, max_text_width, 3);
        if !lines.is_empty() {
            credit_block = Some((lines, size));
        }
    }

    if title_block.is_none() && credit_block.is_none() {
        return Err("The overlay contains no drawable text.".to_string());
    }

    let title_height = title_block
        .as_ref()
        .map(|(lines, size)| lines.len() as f32 * line_height(*size))
        .unwrap_or(0.0);
    let credit_height = credit_block
        .as_ref()
        .map(|(lines, size)| lines.len() as f32 * line_height(*size))
        .unwrap_or(0.0);

    let title_on_top = matches!(title_position, TitlePosition::Top);
    let title_y = if title_on_top {
        margin_y
    } else {
        height as f32 - margin_y - title_height
    };
    let credit_y = if title_on_top {
        height as f32 - margin_y - credit_height
    } else {
        margin_y
    };

    let mut rendered_lines: Vec<TextLine> = Vec::new();

    if let Some((lines, size)) = title_block {
        push_lines(
            &mut rendered_lines,
            &fonts.bold,
            &lines,
            size,
            title_y,
            width,
            Rgba([255, 250, 242, 248]),
        );
    }
    if let Some((lines, size)) = credit_block {
        push_lines(
            &mut rendered_lines,
            &fonts.regular,
            &lines,
            size,
            credit_y,
            width,
            Rgba([255, 248, 238, 214]),
        );
    }

    if matches!(text_style, TextStyle::Scrim) {
        let top_text = if title_on_top && !title_text.is_empty() {
            true
        } else {
            !title_on_top && !credit_text.is_empty()
        };
        let bottom_text = if title_on_top && !credit_text.is_empty() {
            true
        } else {
            !title_on_top && !title_text.is_empty()
        };
        if top_text {
            draw_scrim(&mut canvas, true);
        }
        if bottom_text {
            draw_scrim(&mut canvas, false);
        }
    }

    if !rendered_lines.is_empty() {
        let mut shadow = RgbaImage::new(width, height);
        let shadow_color = Rgba([0, 0, 0, 238]);
        let shadow_offset = (height as f32 / 500.0).clamp(1.0, 5.0).round() as i32;
        for line in &rendered_lines {
            draw_text_mut(
                &mut shadow,
                shadow_color,
                line.x,
                line.y + shadow_offset,
                PxScale::from(line.size),
                &line.font,
                &line.text,
            );
        }

        let blur_radius = (height as f32 * 0.007).clamp(1.0, 9.0);
        let blurred = image::imageops::blur(&shadow, blur_radius);
        image::imageops::overlay(&mut canvas, &blurred, 0, 0);

        for line in &rendered_lines {
            draw_text_mut(
                &mut canvas,
                line.color,
                line.x,
                line.y,
                PxScale::from(line.size),
                &line.font,
                &line.text,
            );
        }
    }

    canvas
        .save_with_format(destination, ImageFormat::Png)
        .map_err(|error| format!("Couldn't create the text overlay: {error}"))
}

fn line_height(size: f32) -> f32 {
    size * 1.22
}

fn push_lines(
    output: &mut Vec<TextLine>,
    font: &FontArc,
    lines: &[String],
    size: f32,
    start_y: f32,
    width: u32,
    color: Rgba<u8>,
) {
    let scale = PxScale::from(size);
    for (index, text) in lines.iter().enumerate() {
        let (text_width, _) = text_size(scale, font, text);
        let x = ((width as f32 - text_width as f32) / 2.0).round() as i32;
        let y = (start_y + index as f32 * line_height(size)).round() as i32;
        output.push(TextLine {
            text: text.clone(),
            x,
            y,
            size,
            font: font.clone(),
            color,
        });
    }
}

fn draw_scrim(canvas: &mut RgbaImage, top: bool) {
    let width = canvas.width();
    let height = canvas.height();
    let scrim_height = ((height as f32) * 0.36).round() as u32;
    let scrim_height = scrim_height.clamp(1, height);

    for y in 0..scrim_height {
        let progress = y as f32 / scrim_height.max(1) as f32;
        let alpha = ((1.0 - progress).powi(2) * 168.0).round() as u8;
        if alpha == 0 {
            continue;
        }
        let target_y = if top { y } else { height - 1 - y };
        for x in 0..width {
            let pixel = canvas.get_pixel_mut(x, target_y);
            let existing = *pixel;
            if existing[3] == 0 {
                *pixel = Rgba([0, 0, 0, alpha]);
            } else {
                *pixel = blend_over(Rgba([0, 0, 0, alpha]), existing);
            }
        }
    }
}

fn blend_over(top: Rgba<u8>, bottom: Rgba<u8>) -> Rgba<u8> {
    let ta = top[3] as f32 / 255.0;
    let ba = bottom[3] as f32 / 255.0;
    let out_a = ta + ba * (1.0 - ta);
    if out_a <= f32::EPSILON {
        return Rgba([0, 0, 0, 0]);
    }
    let channel = |idx: usize| {
        ((top[idx] as f32 * ta + bottom[idx] as f32 * ba * (1.0 - ta)) / out_a).round() as u8
    };
    Rgba([channel(0), channel(1), channel(2), (out_a * 255.0).round() as u8])
}

fn fit_lines(
    font: &FontArc,
    text: &str,
    initial_size: f32,
    max_width: f32,
    max_lines: usize,
) -> (Vec<String>, f32) {
    let minimum_size = (initial_size * 0.58).max(6.0).min(initial_size);
    let mut size = initial_size;

    loop {
        let lines = wrap_text(font, text, size, max_width);
        if lines.len() <= max_lines || size <= minimum_size + 0.01 {
            let mut lines = lines;
            if lines.len() > max_lines {
                lines.truncate(max_lines);
                if let Some(last) = lines.last_mut() {
                    trim_with_ellipsis(font, last, size, max_width);
                }
            }
            return (lines, size);
        }
        size = (size * 0.91).max(minimum_size);
    }
}

fn trim_with_ellipsis(font: &FontArc, line: &mut String, size: f32, max_width: f32) {
    if text_width(font, line, size) <= max_width {
        return;
    }
    while !line.is_empty()
        && text_width(font, &format!("{}…", line.trim_end()), size) > max_width
    {
        line.pop();
    }
    *line = format!("{}…", line.trim_end());
}

fn wrap_text(font: &FontArc, text: &str, size: f32, max_width: f32) -> Vec<String> {
    let mut result = Vec::new();
    for paragraph in text.split('\n') {
        let paragraph = paragraph.trim();
        if paragraph.is_empty() {
            continue;
        }
        let mut current = String::new();

        for word in paragraph.split_whitespace() {
            let candidate = if current.is_empty() {
                word.to_string()
            } else {
                format!("{current} {word}")
            };

            if text_width(font, &candidate, size) <= max_width {
                current = candidate;
                continue;
            }

            if !current.is_empty() {
                result.push(std::mem::take(&mut current));
            }

            if text_width(font, word, size) <= max_width {
                current = word.to_string();
            } else {
                let mut chunk = String::new();
                for ch in word.chars() {
                    let test = format!("{chunk}{ch}");
                    if !chunk.is_empty() && text_width(font, &test, size) > max_width {
                        result.push(chunk);
                        chunk = ch.to_string();
                    } else {
                        chunk = test;
                    }
                }
                current = chunk;
            }
        }

        if !current.is_empty() {
            result.push(current);
        }
    }
    result
}

fn text_width(font: &FontArc, text: &str, size: f32) -> f32 {
    text_size(PxScale::from(size), font, text).0 as f32
}

fn load_fonts(typeface: Typeface) -> Result<FontPair, String> {
    let (bold_candidates, regular_candidates): (Vec<PathBuf>, Vec<PathBuf>) = match typeface {
        Typeface::Sans => (
            vec![
                "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
                "/Library/Fonts/Arial Bold.ttf",
                "/System/Library/Fonts/Supplemental/Arial Black.ttf",
            ]
            .into_iter()
            .map(PathBuf::from)
            .collect(),
            vec![
                "/System/Library/Fonts/Supplemental/Arial.ttf",
                "/Library/Fonts/Arial.ttf",
                "/System/Library/Fonts/Geneva.ttf",
            ]
            .into_iter()
            .map(PathBuf::from)
            .collect(),
        ),
        Typeface::Serif => (
            vec![
                "/System/Library/Fonts/Supplemental/Georgia Bold.ttf",
                "/Library/Fonts/Georgia Bold.ttf",
                "/System/Library/Fonts/Supplemental/Times New Roman Bold.ttf",
            ]
            .into_iter()
            .map(PathBuf::from)
            .collect(),
            vec![
                "/System/Library/Fonts/Supplemental/Georgia.ttf",
                "/Library/Fonts/Georgia.ttf",
                "/System/Library/Fonts/Supplemental/Times New Roman.ttf",
            ]
            .into_iter()
            .map(PathBuf::from)
            .collect(),
        ),
    };

    let bold = load_first_font(&bold_candidates)
        .or_else(|| load_first_font(&regular_candidates))
        .ok_or_else(|| {
            "Couldn't find a system font for the title overlay. Install Arial or Georgia and try again."
                .to_string()
        })?;
    let regular = load_first_font(&regular_candidates).unwrap_or_else(|| bold.clone());
    Ok(FontPair { bold, regular })
}

fn load_first_font(candidates: &[PathBuf]) -> Option<FontArc> {
    for path in candidates {
        let Ok(bytes) = std::fs::read(path) else {
            continue;
        };
        if let Ok(font) = FontArc::try_from_vec(bytes) {
            return Some(font);
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wraps_long_text() {
        let fonts = load_fonts(Typeface::Sans).expect("system font");
        let lines = wrap_text(&fonts.bold, "A very long title that should wrap onto more lines", 24.0, 120.0);
        assert!(lines.len() > 1);
        assert!(!lines.is_empty());
    }

    #[test]
    fn writes_a_transparent_overlay() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("overlay.png");
        render_overlay(
            &path,
            640,
            360,
            "A small title",
            "A credit",
            TitlePosition::Top,
            TextStyle::Shadow,
            Typeface::Sans,
            100,
        )
        .expect("overlay");
        let image = image::open(&path).expect("image");
        assert_eq!(image.width(), 640);
        assert_eq!(image.height(), 360);
    }
}
