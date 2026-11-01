import type { CSSProperties } from "react";
import { useT } from "../i18n";
import {
  Skeleton as ArcSkeleton,
  type SkeletonProps as ArcSkeletonProps,
} from "./arc/skeleton/skeleton";
import styles from "./Skeleton.module.css";

export type SkeletonProps = ArcSkeletonProps & {
  /** `span` renders one inline bar that is valid inside a paragraph (Markdown or media
   *  placeholders). `lines`, `avatar` and `children` are ignored in that form. Default `div`. */
  as?: "div" | "span";
  /** Shorthand for `as="span"`. */
  inline?: boolean;
  /** Bar width of the inline form (any CSS length). Default `6em`. */
  width?: string;
};

export function Skeleton({
  label,
  className,
  as = "div",
  inline = false,
  width,
  lines,
  avatar,
  children,
  loading,
  "aria-hidden": ariaHidden,
}: SkeletonProps) {
  const t = useT();
  const resolvedLabel = label ?? t("Loading…");
  if (as === "span" || inline) {
    const hidden = ariaHidden === true || ariaHidden === "true";
    return (
      <span
        className={["bycoda-arc", styles.inline, className].filter(Boolean).join(" ")}
        role={hidden ? undefined : "status"}
        aria-label={hidden ? undefined : resolvedLabel}
        aria-busy={hidden ? undefined : true}
        aria-hidden={hidden || undefined}
        style={width ? ({ "--skeleton-inline-width": width } as CSSProperties) : undefined}
      />
    );
  }
  return (
    <ArcSkeleton
      lines={lines}
      avatar={avatar}
      loading={loading}
      aria-hidden={ariaHidden}
      label={resolvedLabel}
      className={["bycoda-arc", className].filter(Boolean).join(" ")}
    >
      {children}
    </ArcSkeleton>
  );
}
