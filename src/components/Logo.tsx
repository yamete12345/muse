import { useId } from "react";

/** The mutxt mark: a glassy tile with three lyric lines, the first one lit and glowing. */
export function Logo({ size = 32, className }: { size?: number; className?: string }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg width={size} height={size} viewBox="0 0 1024 1024" className={className} aria-hidden>
      <defs>
        <linearGradient id={`${id}-bg`} x1="0.1" y1="0" x2="0.9" y2="1">
          <stop offset="0" stopColor="#ff6b8b" />
          <stop offset="0.48" stopColor="#a24bff" />
          <stop offset="1" stopColor="#3b2fb8" />
        </linearGradient>
        <radialGradient id={`${id}-blob`} cx="0.78" cy="0.82" r="0.55">
          <stop offset="0" stopColor="#38d6ff" stopOpacity="0.75" />
          <stop offset="1" stopColor="#38d6ff" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${id}-sheen`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.5" />
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
      <rect x="66" y="66" width="892" height="892" rx="234" fill="none" stroke="#fff" strokeOpacity="0.35" strokeWidth="4" />
      <rect x="232" y="300" width="560" height="108" rx="54" fill="#fff" opacity="0.55" filter={`url(#${id}-glow)`} />
      <rect x="232" y="300" width="560" height="108" rx="54" fill={`url(#${id}-fill)`} />
      <rect x="232" y="478" width="430" height="96" rx="48" fill="#fff" opacity="0.4" filter={`url(#${id}-soft)`} />
      <rect x="232" y="640" width="300" height="96" rx="48" fill="#fff" opacity="0.2" filter={`url(#${id}-soft)`} />
    </svg>
  );
}
