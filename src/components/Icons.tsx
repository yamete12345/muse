import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement> & { size?: number };

const base = ({ size = 18, ...rest }: P) => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "currentColor",
  "aria-hidden": true,
  ...rest,
});

export const PlayIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M7.5 4.6c0-1 1.1-1.6 1.9-1.1l11 6.9c.8.5.8 1.7 0 2.2l-11 6.9c-.8.5-1.9-.1-1.9-1.1V4.6Z" />
  </svg>
);

export const PauseIcon = (p: P) => (
  <svg {...base(p)}>
    <rect x="5.5" y="4" width="4.6" height="16" rx="1.4" />
    <rect x="13.9" y="4" width="4.6" height="16" rx="1.4" />
  </svg>
);

export const NextIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M2.8 6.3c0-.8.9-1.3 1.6-.9l8 5.7c.6.4.6 1.4 0 1.8l-8 5.7c-.7.4-1.6 0-1.6-.9V6.3Z" />
    <path d="M11.8 6.3c0-.8.9-1.3 1.6-.9l8 5.7c.6.4.6 1.4 0 1.8l-8 5.7c-.7.4-1.6 0-1.6-.9V6.3Z" />
  </svg>
);

export const PrevIcon = (p: P) => (
  <svg {...base(p)} style={{ transform: "scaleX(-1)" }}>
    <path d="M2.8 6.3c0-.8.9-1.3 1.6-.9l8 5.7c.6.4.6 1.4 0 1.8l-8 5.7c-.7.4-1.6 0-1.6-.9V6.3Z" />
    <path d="M11.8 6.3c0-.8.9-1.3 1.6-.9l8 5.7c.6.4.6 1.4 0 1.8l-8 5.7c-.7.4-1.6 0-1.6-.9V6.3Z" />
  </svg>
);

const stroke = (p: P) => ({ ...base(p), fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const });

export const CloseIcon = (p: P) => (
  <svg {...stroke(p)}>
    <path d="M6 6l12 12M18 6 6 18" />
  </svg>
);

export const MinimizeIcon = (p: P) => (
  <svg {...stroke(p)}>
    <path d="M6 12h12" />
  </svg>
);

export const MaximizeIcon = (p: P) => (
  <svg {...stroke(p)}>
    <rect x="6" y="6" width="12" height="12" rx="3" />
  </svg>
);

export const MoreIcon = (p: P) => (
  <svg {...base(p)}>
    <circle cx="5.5" cy="12" r="1.9" />
    <circle cx="12" cy="12" r="1.9" />
    <circle cx="18.5" cy="12" r="1.9" />
  </svg>
);

export const WidgetIcon = (p: P) => (
  <svg {...stroke(p)}>
    <rect x="3.5" y="4.5" width="17" height="12" rx="2.5" />
    <path d="M7 9h7M7 12.5h4.5M9 20h6" />
  </svg>
);

export const SunIcon = (p: P) => (
  <svg {...stroke(p)}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" />
  </svg>
);

export const MoonIcon = (p: P) => (
  <svg {...stroke(p)}>
    <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" />
  </svg>
);

export const MinusIcon = (p: P) => (
  <svg {...stroke(p)}>
    <path d="M7 12h10" />
  </svg>
);

export const PlusIcon = (p: P) => (
  <svg {...stroke(p)}>
    <path d="M12 7v10M7 12h10" />
  </svg>
);

export const GearIcon = (p: P) => (
  <svg {...stroke(p)}>
    <circle cx="12" cy="12" r="3.2" />
    <path d="M19.4 13.5a7.6 7.6 0 0 0 0-3l2-1.6-2-3.4-2.4 1a7.5 7.5 0 0 0-2.6-1.5L14 2.5h-4l-.4 2.5A7.5 7.5 0 0 0 7 6.5l-2.4-1-2 3.4 2 1.6a7.6 7.6 0 0 0 0 3l-2 1.6 2 3.4 2.4-1a7.5 7.5 0 0 0 2.6 1.5l.4 2.5h4l.4-2.5a7.5 7.5 0 0 0 2.6-1.5l2.4 1 2-3.4-2-1.6Z" />
  </svg>
);

export const PenIcon = (p: P) => (
  <svg {...stroke(p)}>
    <path d="M4 20h4L19.3 8.7a2.1 2.1 0 0 0 0-3l-1-1a2.1 2.1 0 0 0-3 0L4 16v4Z" />
    <path d="M13.5 6.5l4 4" />
  </svg>
);

export const TrashIcon = (p: P) => (
  <svg {...stroke(p)}>
    <path d="M4.5 7h15M9.5 7V4.8c0-.4.4-.8.8-.8h3.4c.4 0 .8.4.8.8V7M6.5 7l.8 12.2c.1.9.8 1.8 1.8 1.8h5.8c1 0 1.7-.9 1.8-1.8L17.5 7" />
  </svg>
);

export const BackIcon = (p: P) => (
  <svg {...stroke(p)}>
    <path d="M14.5 6l-6 6 6 6" />
  </svg>
);

export const ReplayIcon = (p: P) => (
  <svg {...stroke(p)}>
    <path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3" />
    <path d="M4.5 4.5v3.7h3.7" />
  </svg>
);

export const ForwardIcon = (p: P) => (
  <svg {...stroke(p)} style={{ transform: "scaleX(-1)" }}>
    <path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3" />
    <path d="M4.5 4.5v3.7h3.7" />
  </svg>
);

export const TapIcon = (p: P) => (
  <svg {...stroke(p)}>
    <path d="M12 3v3M5.6 5.6l2 2M3 12h3M18.4 5.6l-2 2M21 12h-3" />
    <circle cx="12" cy="14.5" r="5" />
  </svg>
);

export const NoteIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M18 3.2v11.3a3.3 3.3 0 1 1-2-3V7.4l-7 1.6v7.5a3.3 3.3 0 1 1-2-3V6.5c0-.6.4-1.1 1-1.2l8.8-2.1c.6-.1 1.2.3 1.2 1Z" />
  </svg>
);
