# Gifsmith

A native macOS app for turning video clips into polished, share-ready GIFs. Built with Rust, [Tauri 2](https://tauri.app), React, and the system FFmpeg.

Drop in one or more videos, trim the moment you want, choose how it plays, add a title and credit, and export a palette-optimized GIF without leaving the app.

![Gifsmith](src-tauri/icons/source.png)

## Features

- **Import your way** — file picker (`⌘O`), folder picker (`⇧⌘O`), or drag and drop onto the window.
- **Trim** — drag the round-trip handles or use `I` / `O` to set in and out points at the playhead.
- **Forward, reverse, or boomerang** — reverse playback or play forward-then-back with one click.
- **Title and credit text** — type a title and credit line, place them at the top or bottom, choose sans or serif, and pick a soft shadow or gradient scrim. A live preview shows the exact placement.
- **Size and palette controls** — output width (with source-aware presets), frame rate, color count, dithering method (Sierra, Bayer, or none), and frame-diff optimization. Two-pass `palettegen` / `paletteuse` keeps gradients clean and files small.
- **Remembers everything** — all settings, including the output folder, are saved between sessions.
- **Per-clip results** — switch between imported clips and preview each exported GIF.
- **Native touches** — macOS overlay title bar, Finder reveal, and export progress that can be cancelled mid-render.

## Requirements

- macOS 11 or later
- [FFmpeg](https://ffmpeg.org) (with `ffmpeg` and `ffprobe` on your `PATH`, or in `/opt/homebrew/bin` / `/usr/local/bin`)

  ```sh
  brew install ffmpeg
  ```

  Gifsmith checks for FFmpeg at launch and shows an install hint if it can't be found. The app intentionally uses the system FFmpeg rather than bundling a large binary.

- For development: Node 20.19+ and Rust 1.77.2+

## Development

```sh
npm install
npm run tauri dev
```

The Vite frontend runs on <http://localhost:1420>; Tauri opens the native window.

Run the Rust tests (they generate a short test clip with FFmpeg):

```sh
cd src-tauri && cargo test
```

## Building the macOS app

```sh
npm run tauri build
```

The `.app` and `.dmg` are written to:

```
src-tauri/target/release/bundle/macos/Gifsmith.app
src-tauri/target/release/bundle/dmg/Gifsmith_1.0.0_*.dmg
```

The bundle is unsigned, so first launch may require right-click → Open.

## Using Gifsmith

1. Import a clip with the **Add** buttons, `⌘O`, or by dropping a video onto the window.
2. Choose a moment with the trim timeline. Press `Space` to preview, `I` / `O` to set the selection.
3. Pick **Forward**, **Reverse**, or **Boomerang** under Motion.
4. Adjust width, frame rate, colors, and dithering. The summary shows the output dimensions, length, and frame count.
5. Add optional title and credit text.
6. Choose where to save (the source folder is the default) and press **Export GIF** (`⌘⏎`). Press `Esc` to cancel.

Supported inputs: `mp4`, `m4v`, `mov`, `qt`, `mkv`, `webm`, `avi`, `mpg`, `mpeg`, `m2v`, `wmv`, `flv`, `3gp`, and `gif`. If a codec can't be previewed in the webview, Gifsmith still exports it through FFmpeg.

## Settings

Settings are stored as JSON and written atomically after each change:

```
~/Library/Application Support/com.gifsmith.app/settings.json
```

Deleting that file restores the defaults.

## Project layout

```
src/                    React frontend
  components/           Title bar, library, preview, inspector, controls
  lib/format.ts         Formatting and output-size helpers
  App.tsx               Application state, import/export flow
src-tauri/src/
  lib.rs                Tauri commands and app setup
  ffmpeg.rs             Two-pass GIF pipeline, reverse/boomerang, progress and cancellation
  media.rs              FFprobe import, thumbnails, folder scanning
  overlay.rs            Title/credit PNG rendering
  settings.rs           Persisted settings
src-tauri/icons/        App icons (master is source.png; make-icon.py regenerates it)
```

## Notes

- Text is rendered into a transparent PNG in Rust and composited by FFmpeg, so it works with FFmpeg builds that lack `drawtext`.
- Exports never overwrite an existing GIF; a numbered name is chosen instead.
- FFmpeg processes are launched directly with argument arrays — no shell interpolation of user paths.
