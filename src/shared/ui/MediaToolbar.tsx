import type { ReactNode } from "react";
import { Button, type ButtonProps } from "./Button";

/**
 * The one toolbar family for media tools (lightbox, compare, annotation): 28px controls, 14px glyphs, 4px gaps.
 * `overlay` sits on the media backdrop (secondary Buttons); `surface` sits on a pane (ghost Buttons).
 */
export type MediaToolbarTone = "overlay" | "surface";

export function MediaToolbar({
  label,
  tone = "overlay",
  className,
  children,
}: {
  /** Accessible name of the toolbar. */
  label: string;
  tone?: MediaToolbarTone;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      role="toolbar"
      aria-label={label}
      data-media-toolbar={tone}
      className={["flex min-w-0 flex-wrap items-center gap-1", className].filter(Boolean).join(" ")}
    >
      {children}
    </div>
  );
}

type IconActionProps = Omit<ButtonProps, "iconOnly" | "label" | "size" | "variant" | "tone"> & {
  label: string;
  tone?: MediaToolbarTone;
};

/** Icon action of the media toolbar. Pass a 14px glyph (`className="icon-sm"`) as the child. */
export function MediaToolbarButton({ label, tone = "overlay", tooltip, ...props }: IconActionProps) {
  return (
    <Button
      {...props}
      iconOnly
      size="sm"
      label={label}
      tooltip={tooltip ?? label}
      variant={tone === "overlay" ? "secondary" : "ghost"}
    />
  );
}
