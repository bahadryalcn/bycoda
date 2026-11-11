// Official free Arc registry source, adapted to bycoda shared semantics.
"use client";

import { isValidElement, useEffect, useLayoutEffect, useRef } from "react";
import type { HTMLAttributes, ReactNode } from "react";
import {
  animate,
  motion,
  useMotionValue,
  useReducedMotion,
  type AnimationPlaybackControls,
} from "motion/react";
import { observeResize } from "../../../lib/observeResize";
import { motionTokens } from "../lib/motion-tokens";
import styles from "./badge.module.css";

export type BadgeTone = "neutral" | "accent" | "success" | "info" | "warning" | "danger";
export type BadgeSize = "sm" | "md";

/** `label` is the bordered default; `dot` is a status dot with optional text; `count` is a compact numeric counter. */
export type BadgeVariant = "label" | "dot" | "count";
/** `outline` keeps the toned border; `subtle` is the borderless tone-subtle fill. */
export type BadgeAppearance = "outline" | "subtle";

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  /** Use accent for workspace emphasis; semantic info/status tones stay independent. */
  tone?: BadgeTone;
  size?: BadgeSize;
  icon?: ReactNode;
  variant?: BadgeVariant;
  appearance?: BadgeAppearance;
  /** Accessible name. A `dot` without text needs it to carry meaning; without one it is decorative and hidden from assistive tech. A `count` can use it for context, such as "12 unread". */
  label?: string;
  /** For `count`: numbers above this render as `max+`. */
  max?: number;
}

/** Track icon identity without treating every React element allocation as a change. */
function iconKey(icon: ReactNode) {
  if (!isValidElement(icon)) return "icon";
  const type = icon.type as string | { displayName?: string; name?: string };
  return typeof type === "string" ? type : (type.displayName ?? type.name ?? "icon");
}

export function Badge({
  tone = "neutral",
  size = "md",
  icon,
  variant = "label",
  appearance = "outline",
  label,
  max,
  className,
  children,
  ...props
}: BadgeProps) {
  const reduce = useReducedMotion();
  const text =
    typeof children === "number" && variant === "count" && max !== undefined && children > max
      ? `${max}+`
      : typeof children === "string" || typeof children === "number"
        ? String(children)
        : null;
  const dotOnly = variant === "dot" && (children === undefined || children === null);
  // A capped count still exposes its real number, and a dot with no name is decoration rather than a colour-only status.
  const name =
    label ??
    (variant === "count" && typeof children === "number" && text !== String(children)
      ? String(children)
      : undefined);
  const glyphKey = icon ? iconKey(icon) : "";
  const body = useRef<HTMLSpanElement>(null);
  const content = useRef<HTMLSpanElement>(null);
  // Width stays auto at rest. Only a new label or icon springs it from the old size to the new one; passive reflows (a font swap, a hidden parent) follow instantly.
  const width = useMotionValue<number | "auto">("auto");
  const changedAt = useRef(0);
  useLayoutEffect(() => {
    changedAt.current = performance.now();
  }, [text, glyphKey]);
  useEffect(() => {
    const node = content.current;
    if (!node) return;
    // Reduced motion never springs, so there is nothing to observe; an animation cut short by the switch is released.
    if (reduce) {
      width.jump("auto");
      if (body.current) {
        body.current.style.width = "auto";
        delete body.current.dataset.morphing;
      }
      return;
    }
    let last: number | undefined;
    let controls: AnimationPlaybackControls | undefined;
    const settle = () => {
      width.jump("auto");
      if (body.current) {
        body.current.style.width = "auto";
        delete body.current.dataset.morphing;
      }
    };
    const unobserve = observeResize(node, (entry) => {
      const next = entry.borderBoxSize?.[0]?.inlineSize ?? node.offsetWidth;
      const current = width.get();
      const from = typeof current === "number" ? current : last;
      last = next;
      controls?.stop();
      if (from === undefined || from === next || performance.now() - changedAt.current > 120)
        return settle();
      // Pin the old width before this frame paints, then spring to the new one.
      // While morphing the label keeps its natural one-line width and the body clips it, so the
      // pinned old width never wraps the text letter by letter and the target width is measured true.
      if (body.current) {
        body.current.style.width = `${from}px`;
        body.current.dataset.morphing = "";
      }
      controls = animate(width, [from, next], { ...motionTokens.spring.morph, onComplete: settle });
    });
    return () => {
      unobserve();
      controls?.stop();
    };
  }, [width, reduce]);
  const classes = [
    styles.badge,
    styles[tone],
    styles[size],
    variant !== "label" && styles[variant],
    appearance === "subtle" && styles.subtle,
    className,
  ]
    .filter(Boolean)
    .join(" ");
  const a11y = name
    ? { "aria-label": name, ...(dotOnly ? { role: "img" } : {}) }
    : dotOnly
      ? { "aria-hidden": true as const }
      : {};
  // Replace outgoing content immediately: stale labels would inherit the new status tone.
  // Keep content visible on mount and under reduced motion; only width animates.
  return (
    <span {...a11y} {...props} className={classes}>
      <motion.span ref={body} className={styles.body} style={{ width }}>
        <span ref={content} className={styles.content}>
          {variant === "dot" ? <span className={styles.dotMark} aria-hidden="true" /> : null}
          {icon ? (
            <span className={styles.icon} aria-hidden="true">
              <span className={styles.glyph}>{icon}</span>
            </span>
          ) : null}
          {text === null ? (
            children
          ) : (
            <span className={styles.label}>
              <span className={styles.text}>{text}</span>
            </span>
          )}
        </span>
      </motion.span>
    </span>
  );
}

export default Badge;
