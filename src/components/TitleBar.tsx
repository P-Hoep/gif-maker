import { AlertCircle, Check, LoaderCircle } from "lucide-react";
import type { SaveState, VideoAsset } from "../types";
import { formatDimensions } from "../lib/format";
import { BrandMark } from "./BrandMark";

interface TitleBarProps {
  video: VideoAsset | null;
  saveState: SaveState;
}

function SaveIndicator({ saveState }: { saveState: SaveState }) {
  if (saveState === "idle") return null;
  if (saveState === "saving") {
    return (
      <span className="save-indicator">
        <LoaderCircle size={12} className="spin" />
        Saving
      </span>
    );
  }
  if (saveState === "error") {
    return (
      <span className="save-indicator is-error" title="Your settings couldn't be saved">
        <AlertCircle size={12} />
        Not saved
      </span>
    );
  }
  return (
    <span className="save-indicator">
      <Check size={12} />
      Saved
    </span>
  );
}

export function TitleBar({ video, saveState }: TitleBarProps) {
  return (
    <header className="titlebar" data-tauri-drag-region>
      <div className="titlebar-brand" data-tauri-drag-region>
        <BrandMark size={22} />
        <span className="brand-name" data-tauri-drag-region>
          Gifsmith
        </span>
      </div>
      <span className="titlebar-divider" data-tauri-drag-region />
      <div className="titlebar-context" data-tauri-drag-region>
        {video ? (
          <>
            <span className="titlebar-file" data-tauri-drag-region>
              {video.fileName}
            </span>
            <span className="titlebar-meta">
              {formatDimensions(video.width, video.height)} · {video.extension}
            </span>
          </>
        ) : (
          <span className="titlebar-file is-muted">Untitled loop</span>
        )}
      </div>
      <div className="titlebar-spacer" data-tauri-drag-region />
      <SaveIndicator saveState={saveState} />
    </header>
  );
}
