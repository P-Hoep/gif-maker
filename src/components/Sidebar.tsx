import { Film, FolderPlus, LoaderCircle, Plus, Trash2 } from "lucide-react";
import type { ToolsStatus, VideoAsset } from "../types";
import { formatDimensions, formatDuration } from "../lib/format";

interface SidebarProps {
  videos: VideoAsset[];
  selectedPath: string | null;
  importing: boolean;
  tools: ToolsStatus | null;
  onSelect: (path: string) => void;
  onRemove: (path: string) => void;
  onImportFiles: () => void;
  onImportFolder: () => void;
}

function VideoItem({
  video,
  selected,
  onSelect,
  onRemove,
}: {
  video: VideoAsset;
  selected: boolean;
  onSelect: () => void;
  onRemove: () => void;
}) {
  return (
    <div className={`video-item${selected ? " is-selected" : ""}`}>
      <button
        type="button"
        className="video-select"
        onClick={onSelect}
        aria-current={selected ? "true" : undefined}
        title={video.path}
      >
        <span className="video-thumb">
          {video.thumbnail ? (
            <img src={video.thumbnail} alt="" draggable={false} />
          ) : (
            <Film size={18} strokeWidth={1.6} />
          )}
          <span className="video-duration">{formatDuration(video.duration)}</span>
        </span>
        <span className="video-copy">
          <span className="video-name">{video.fileName}</span>
          <span className="video-meta">
            {formatDimensions(video.width, video.height)}
            <span className="meta-dot" />
            {video.codec}
          </span>
        </span>
      </button>
      <button
        type="button"
        className="video-remove"
        aria-label={`Remove ${video.fileName} from library`}
        title="Remove from library"
        onClick={(event) => {
          event.stopPropagation();
          onRemove();
        }}
      >
        <Trash2 size={13} />
      </button>
    </div>
  );
}

export function Sidebar({
  videos,
  selectedPath,
  importing,
  tools,
  onSelect,
  onRemove,
  onImportFiles,
  onImportFolder,
}: SidebarProps) {
  return (
    <aside className="sidebar">
      <div className="sidebar-top">
        <div className="library-heading">
          <div className="library-title">
            <span>Library</span>
            <span className="count-badge">{videos.length}</span>
          </div>
          <div className="library-actions">
            <button
              type="button"
              className="icon-button"
              onClick={onImportFiles}
              disabled={importing}
              aria-label="Import video files"
              title="Import videos (⌘O)"
            >
              <Plus size={15} />
            </button>
            <button
              type="button"
              className="icon-button"
              onClick={onImportFolder}
              disabled={importing}
              aria-label="Import a folder"
              title="Import a folder (⇧⌘O)"
            >
              <FolderPlus size={15} />
            </button>
          </div>
        </div>
        <p className="library-subtitle">Your source clips, kept close by.</p>
      </div>

      <div className="video-list">
        {importing && (
          <div className="importing-row">
            <LoaderCircle size={14} className="spin" />
            <span>Scanning videos…</span>
          </div>
        )}

        {videos.length === 0 && !importing ? (
          <div className="library-empty">
            <div className="library-empty-mark">
              <Film size={22} strokeWidth={1.35} />
            </div>
            <p>Nothing here yet.</p>
            <span>Drop a video in, or add one with the buttons above.</span>
          </div>
        ) : (
          videos.map((video) => (
            <VideoItem
              key={video.path}
              video={video}
              selected={video.path === selectedPath}
              onSelect={() => onSelect(video.path)}
              onRemove={() => onRemove(video.path)}
            />
          ))
        )}
      </div>

      <div className="sidebar-footer">
        <div
          className={`tool-status${tools?.available ? " is-ready" : " is-missing"}`}
          title={tools?.error ?? undefined}
        >
          <span className="status-dot" />
          <span>
            {tools === null
              ? "Checking FFmpeg…"
              : tools.available
                ? `FFmpeg ${tools.version ?? "ready"}`
                : "FFmpeg not found"}
          </span>
        </div>
        <span className="drop-hint">Drop files or folders anywhere</span>
      </div>
    </aside>
  );
}
