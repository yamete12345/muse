import { useId } from "react";

/** The MUSE mark: a glassy tile with three lyric lines; the middle one is being sung, half lit. */
export function Logo({ size = 32, className }: { size?: number; className?: string }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg width={size} height={size} viewBox="0 0 1024 1024" className={className} aria-hidden>
      <defs>
        <linearGradient id={`${id}-bg`} x1="0.1" y1="0" x2="0.9" y2="1">
          <stop offset="0" stopColor="#3a4a52" />
          <stop offset="0.5" stopColor="#1a2126" />
          <stop offset="1" stopColor="#0b0d0f" />
        </linearGradient>
        <radialGradient id={`${id}-blob`} cx="0.8" cy="0.84" r="0.6">
          <stop offset="0" stopColor="#5d6a70" stopOpacity="0.55" />
          <stop offset="1" stopColor="#5d6a70" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${id}-sheen`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.34" />
          <stop offset="0.42" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <filter id={`${id}-glow`} x="-30%" y="-80%" width="160%" height="260%">
          <feGaussianBlur stdDeviation="26" />
        </filter>
      </defs>
      <rect x="64" y="64" width="896" height="896" rx="236" fill={`url(#${id}-bg)`} />
      <rect x="64" y="64" width="896" height="896" rx="236" fill={`url(#${id}-blob)`} />
      <rect x="64" y="64" width="896" height="896" rx="236" fill={`url(#${id}-sheen)`} />
      <rect x="66" y="66" width="892" height="892" rx="234" fill="none" stroke="#fff" strokeOpacity="0.22" strokeWidth="4" />
      <rect x="204" y="449" width="434" height="126" rx="63" fill="#fff" opacity="0.45" filter={`url(#${id}-glow)`} />
      <rect x="204" y="281" width="420" height="84" rx="42" fill="#fff" opacity="0.3" />
      <rect x="204" y="449" width="616" height="126" rx="63" fill="#fff" opacity="0.3" />
      <rect x="204" y="449" width="434" height="126" rx="63" fill="#fff" />
      <rect x="204" y="659" width="518" height="84" rx="42" fill="#fff" opacity="0.3" />
    </svg>
  );
}
