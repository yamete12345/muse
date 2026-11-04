import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { Glass } from "./Glass/Glass";

export interface LineMenuItem {
  label: string;
  hint?: string;
  onSelect: () => void;
}

/** A small context menu at the cursor; closes on pick, outside click, Esc or scroll. */
export function LineMenu({ x, y, items, onClose }: { x: number; y: number; items: LineMenuItem[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });

  // Keep the menu inside the window.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({ left: Math.min(x, innerWidth - r.width - 8), top: Math.min(y, innerHeight - r.height - 8) });
  }, [x, y]);

  useEffect(() => {
    const close = (e: Event) => {
      if (e instanceof MouseEvent && ref.current?.contains(e.target as Node)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && (e.stopPropagation(), onClose());
    window.addEventListener("mousedown", close, true);
    window.addEventListener("wheel", close, true);
    window.addEventListener("blur", close);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("mousedown", close, true);
      window.removeEventListener("wheel", close, true);
      window.removeEventListener("blur", close);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [onClose]);

  return createPortal(
    <div ref={ref} className="line-menu" style={pos} onContextMenu={(e) => e.preventDefault()}>
      <Glass variant="panel" radius={16} large className="line-menu-glass">
        <div className="line-menu-items">
          {items.map((it) => (
            <button
              key={it.label}
              className="line-menu-item"
              onClick={() => {
                it.onSelect();
                onClose();
              }}
            >
              <span>{it.label}</span>
              {it.hint && <small>{it.hint}</small>}
            </button>
          ))}
        </div>
      </Glass>
    </div>,
    document.body,
  );
}
