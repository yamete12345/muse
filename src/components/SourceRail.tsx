import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

import { updateSettings } from "../core/api";
import { useStore } from "../core/store";

interface MediaSource {
  appId: string;
  name: string;
  title: string;
  artist: string;
  playing: boolean;
  shown: boolean;
  cover: string;
}

const REFRESH_MS = 3000;
/** Covers by track key; a cover is fetched once per track. */
const covers = new Map<string, string>();

/** Everything playing in Windows, refreshed while the window is visible. */
function useSources(): [MediaSource[], () => void] {
  const [list, setList] = useState<MediaSource[]>([]);
  const mediaKey = useStore((s) => s.media?.key ?? "");
  const loadRef = useRef<() => void>(() => {});

  useEffect(() => {
    let alive = true;
    const load = async () => {
      if (document.visibilityState !== "visible") return;
      const next = await invoke<MediaSource[]>("list_media_sources").catch(() => null);
      if (!alive || !next) return;
      await Promise.all(
        next
          .filter((x) => x.cover && !covers.has(x.cover))
          .map(async (x) => {
            const url = await invoke<string | null>("source_cover", { key: x.cover }).catch(() => null);
            if (url) covers.set(x.cover, url);
          }),
      );
      if (alive) setList(next);
    };
    loadRef.current = load;
    load();
    const t = setInterval(load, REFRESH_MS);
    document.addEventListener("visibilitychange", load);
    return () => {
      alive = false;
      clearInterval(t);
      document.removeEventListener("visibilitychange", load);
    };
  }, []);

  // A new track somewhere: refresh at once rather than on the next tick.
  useEffect(() => {
    loadRef.current();
  }, [mediaKey]);

  return [list, () => loadRef.current()];
}

/**
 * Covers of every app playing in Windows, at the bottom of the rail. Clicking
 * one shows that app and keeps it shown; clicking the kept one again goes
 * back to "whatever plays".
 */
export function SourceRail() {
  const [sources, reload] = useSources();
  const pinned = useStore((s) => s.settings.mediaSource);
  if (sources.length < 2) return null;

  const pinnedHere = sources.some((x) => x.appId === pinned);
  const pick = (x: MediaSource) => {
    updateSettings({ mediaSource: x.appId === pinned ? "" : x.appId });
    // Rust switches right away; read back which source is shown.
    setTimeout(reload, 250);
    setTimeout(reload, 1200);
  };

  return (
    <>
      <span className="rail-sep" />
      <div className="rail-group rail-sources">
        {sources.slice(0, 5).map((x) => {
          const isPinned = x.appId === pinned;
          const shown = pinnedHere ? isPinned : x.shown;
          const url = x.cover ? covers.get(x.cover) : undefined;
          const line = x.title ? [x.artist, x.title].filter(Boolean).join(" — ") : x.playing ? "Играет" : "Ничего не играет";
          const hint = isPinned
            ? "Закреплено. Нажмите, чтобы снова показывать то, что играет"
            : shown
              ? "Показывается сейчас. Нажмите, чтобы закрепить"
              : "Нажмите, чтобы показывать его";
          return (
            <div className="rail-item" key={x.appId}>
              <button
                className={`src-cover ${shown ? "is-shown" : ""} ${isPinned ? "is-pinned" : ""}`}
                aria-label={`${x.name}: ${line}`}
                aria-pressed={shown}
                onClick={() => pick(x)}
              >
                {url ? <img src={url} alt="" draggable={false} /> : <span className="src-letter">{x.name.slice(0, 1)}</span>}
                {x.playing && (
                  <span className="src-eq" aria-hidden>
                    <i />
                    <i />
                    <i />
                  </span>
                )}
              </button>
              <span className="rail-label rail-label-multi">
                <b>{x.name}</b>
                <small>{line}</small>
                <small className="rail-label-hint">{hint}</small>
              </span>
            </div>
          );
        })}
      </div>
    </>
  );
}
