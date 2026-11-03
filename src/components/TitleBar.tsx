import { useStore } from "../core/store";
import { LiveCover } from "./LiveCover";
import { Logo } from "./Logo";

/** Now-playing header; the whole bar drags the window (double click maximizes). */
export function TitleBar({ showTrack = true }: { showTrack?: boolean }) {
  const media = useStore((s) => s.media);
  const cover = useStore((s) => s.cover);
  const hasTrack = !!media?.title;

  return (
    <header className="titlebar" data-tauri-drag-region="deep">
      {showTrack && (
      <div className={`now ${hasTrack ? "" : "is-empty"}`} key={media?.key ?? "none"}>
        <div className="now-cover">{cover ? <LiveCover src={cover} className="lc-small" /> : <Logo size={64} />}</div>
        <div className="now-text">
          <div className="now-title">{media?.title || "MUSE"}</div>
          <div className="now-artist">{media?.artist || "Ожидание музыки"}</div>
        </div>
      </div>
      )}
    </header>
  );
}
