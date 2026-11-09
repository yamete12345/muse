import { useStore } from "../core/store";

interface Props {
  src: string;
  className?: string;
  /** A soft glow of the artwork behind it; for large covers only. */
  halo?: boolean;
}

/**
 * Artwork that slowly drifts, tilts and catches a highlight while music plays
 * (a stand-in for the video covers streaming apps keep to themselves). All
 * motion is CSS on transform and opacity, so it stays on the compositor.
 * Off in settings, or when the system asks for reduced motion: a still image.
 */
export function LiveCover({ src, className = "", halo = false }: Props) {
  const live = useStore((s) => s.settings.liveCover);
  const playing = useStore((s) => s.media?.playing ?? false);

  return (
    <div className={`lc ${live ? "is-live" : ""} ${playing ? "is-playing" : ""} ${className}`}>
      {halo && (
        <span className="lc-halo-wrap" aria-hidden>
          <img className="lc-halo" src={src} alt="" draggable={false} />
        </span>
      )}
      <div className="lc-frame">
        <img className="lc-img" src={src} alt="" draggable={false} />
        <span className="lc-sheen" aria-hidden />
      </div>
    </div>
  );
}
