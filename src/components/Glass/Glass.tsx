import { forwardRef, useEffect, useImperativeHandle, useRef, type CSSProperties, type HTMLAttributes, type ReactNode } from "react";

import { useStore } from "../../core/store";
import { acquireGlassFilter } from "./glassFilter";
import "./glass.css";

type Variant = "panel" | "pill" | "button";

interface GlassProps extends HTMLAttributes<HTMLElement> {
  as?: "div" | "button";
  variant?: Variant;
  radius?: number;
  /** Displacement strength; 0 disables refraction for this surface. */
  refraction?: number;
  blur?: number;
  /** Large surfaces skip refraction: it is the expensive part. */
  large?: boolean;
  active?: boolean;
  children?: ReactNode;
  disabled?: boolean;
  type?: "button";
}

/**
 * A liquid-glass surface: refracted + blurred backdrop, specular rim, soft
 * shadow, and a highlight that follows the cursor (see core/light.ts).
 */
export const Glass = forwardRef<HTMLElement, GlassProps>(function Glass(
  { as = "div", variant = "panel", radius, refraction = 26, blur = 6, large = false, active, className, style, children, ...rest },
  ref,
) {
  const el = useRef<HTMLElement>(null);
  useImperativeHandle(ref, () => el.current!);
  const simple = useStore((s) => s.settings.simpleGlass);
  const r = radius ?? (variant === "panel" ? 26 : 999);
  const refract = !simple && !large && refraction > 0;

  useEffect(() => {
    const node = el.current;
    if (!node || !refract) return;
    let release: (() => void) | null = null;
    let lastKey = "";
    const update = () => {
      const w = node.offsetWidth;
      const h = node.offsetHeight;
      if (w < 4 || h < 4) return;
      const key = `${w}x${h}`;
      if (key === lastKey) return;
      lastKey = key;
      const f = acquireGlassFilter({ width: w, height: h, radius: Math.min(r, h / 2, w / 2), blur, refraction });
      node.style.setProperty("--lg-backdrop", `url(#${f.id})`);
      release?.();
      release = f.release;
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(node);
    return () => {
      ro.disconnect();
      release?.();
      node.style.removeProperty("--lg-backdrop");
    };
  }, [refract, r, blur, refraction]);

  const Tag = as as "div";
  const classes = ["lg", `lg-${variant}`, refract ? "lg-refract" : "lg-simple", active ? "is-active" : "", className ?? ""]
    .filter(Boolean)
    .join(" ");
  const css: CSSProperties = { ...style, ["--lg-r" as string]: `${r}px` };

  return (
    <Tag ref={el as React.Ref<HTMLDivElement>} className={classes} style={css} {...rest}>
      {children}
    </Tag>
  );
});
