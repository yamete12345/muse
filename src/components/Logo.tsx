import { useId } from "react";

/** The MUSE mark: a glassy tile with three lyric lines, the first one lit and glowing. */
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
        <linearGradient id={`${id}-fill`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0.62" stopColor="#fff" />
          <stop offset="0.78" stopColor="#fff" stopOpacity="0.45" />
        </linearGradient>
        <filter id={`${id}-glow`} x="-30%" y="-80%" width="160%" height="260%">
          <feGaussianBlur stdDeviation="26" />
        </filter>
        <filter id={`${id}-soft`}>
          <feGaussianBlur stdDeviation="7" />
        </filter>
      </defs>
      <rect x="64" y="64" width="896" height="896" rx="236" fill={`url(#${id}-bg)`} />
      <rect x="64" y="64" width="896" height="896" rx="236" fill={`url(#${id}-blob)`} />
      <rect x="64" y="64" width="896" height="896" rx="236" fill={`url(#${id}-sheen)`} />
      <rect x="66" y="66" width="892" height="892" rx="234" fill="none" stroke="#fff" strokeOpacity="0.22" strokeWidth="4" />
      <rect x="232" y="300" width="560" height="108" rx="54" fill="#fff" opacity="0.5" filter={`url(#${id}-glow)`} />
      <rect x="232" y="300" width="560" height="108" rx="54" fill={`url(#${id}-fill)`} />
      <rect x="232" y="478" width="430" height="96" rx="48" fill="#fff" opacity="0.36" filter={`url(#${id}-soft)`} />
      <rect x="232" y="640" width="300" height="96" rx="48" fill="#fff" opacity="0.18" filter={`url(#${id}-soft)`} />
    </svg>
  );
}
