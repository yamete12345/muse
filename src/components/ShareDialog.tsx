import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";

import { useCoverAccent } from "../core/appearance";
import { blobToBase64, canvasToPng, renderShare, type ShareFormat } from "../core/share";
import { useStore } from "../core/store";
import { Glass } from "./Glass/Glass";
import { CloseIcon } from "./Icons";

const FORMATS: [ShareFormat, string, string][] = [
  ["horizontal", "Горизонтальная", "1920 × 1080 · для чатов и рабочего стола"],
  ["vertical", "Вертикальная", "1080 × 1920 · для историй"],
];

type Result = { format: ShareFormat; path: string; copied: boolean } | { error: string };

/** Picks a format for a picture of the chosen lines, then saves and copies it. */
export function ShareDialog({ lines, onClose }: { lines: string[]; onClose: () => void }) {
  const media = useStore((s) => s.media);
  const cover = useStore((s) => s.cover);
  const accent = useCoverAccent();
  const [count, setCount] = useState(1);
  const [previews, setPreviews] = useState<Partial<Record<ShareFormat, string>>>({});
  const [busy, setBusy] = useState<ShareFormat | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  const card = { lines: lines.slice(0, count), title: media?.title ?? "", artist: media?.artist ?? "", cover, accent };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && (e.stopPropagation(), onClose());
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  // Live previews of both formats.
  useEffect(() => {
    let alive = true;
    (async () => {
      const next: Partial<Record<ShareFormat, string>> = {};
      for (const [f] of FORMATS) next[f] = (await renderShare(card, f)).toDataURL("image/jpeg", 0.7);
      if (alive) setPreviews(next);
    })();
    return () => {
      alive = false;
    };
  }, [count, cover, accent, media?.key]);

  const make = async (format: ShareFormat) => {
    setBusy(format);
    try {
      const blob = await canvasToPng(await renderShare(card, format));
      let copied = false;
      try {
        await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
        copied = true;
      } catch {
        // Saving still works when the clipboard refuses.
      }
      const d = new Date();
      const pad = (n: number) => String(n).padStart(2, "0");
      const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
      const name = `${card.artist} - ${card.title} ${stamp}`;
      const path = await invoke<string>("save_share_image", { pngBase64: await blobToBase64(blob), name });
      setResult({ format, path, copied });
    } catch (e) {
      setResult({ error: String(e) });
    } finally {
      setBusy(null);
    }
  };

  // Rendered at the page root: the lyrics sit in a layer under the player and the rail.
  return createPortal(
    <div className="share-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <Glass variant="panel" radius={28} large className="share">
        <div className="share-head">
          <h2>Картинка с текстом</h2>
          <button className="share-close" aria-label="Закрыть" onClick={onClose}>
            <CloseIcon size={14} />
          </button>
        </div>

        {result && "path" in result ? (
          <div className="share-done">
            <img src={previews[result.format]} alt="" />
            <p>
              <b>Готово.</b> {result.copied ? "Картинка скопирована — вставьте её в чат или историю." : "Картинка сохранена."}
            </p>
            <div className="share-actions">
              <button className="link-button link-button-primary" onClick={() => invoke("reveal_file", { path: result.path })}>
                Открыть папку
              </button>
              <button className="link-button" onClick={() => setResult(null)}>
                Сделать ещё
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="share-count">
              <span>Строк</span>
              {[1, 2, 3, 4].filter((n) => n <= lines.length).map((n) => (
                <button key={n} className={`st-chip ${n === count ? "is-on" : ""}`} onClick={() => setCount(n)}>
                  {n}
                </button>
              ))}
            </div>
            <div className="share-formats">
              {FORMATS.map(([f, name, hint]) => (
                <button key={f} className={`share-format is-${f}`} disabled={busy !== null} onClick={() => make(f)}>
                  <span className="share-preview">{previews[f] ? <img src={previews[f]} alt="" /> : <i />}</span>
                  <span className="share-name">{busy === f ? "Создаём…" : name}</span>
                  <span className="share-hint">{hint}</span>
                </button>
              ))}
            </div>
            {result && "error" in result && <p className="share-error">Не получилось: {result.error}</p>}
          </>
        )}
      </Glass>
    </div>,
    document.body,
  );
}
