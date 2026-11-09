import type { ReactNode } from "react";
import { Button, type ButtonProps } from "./Button";

/**
 * The one toolbar family for media tools (lightbox, compare, annotation): 28px controls, 14px glyphs, 4px gaps.
 * `overlay` sits on the media backdrop (secondary Buttons); `surface` sits on a pane (ghost Buttons).
 */
export type MediaToolbarTone = "overlay" | "surface";

/**
 * `role="toolbar"` row for media tools: 28px controls, 14px glyphs, 4px gaps, wraps when narrow. Owns the accessible name.
 * `overlay` tone sits on the media backdrop (secondary Buttons), `surface` on a pane (ghost Buttons).
 * @group media
 * @use Zoom/rotate/compare/annotate controls over an image, video or device preview; fill with MediaToolbarButton.
 * @avoid Page or pane actions: PaneHeader actions. Grouped buttons outside media: ButtonGroup.
 */
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

/**
 * Icon-only 28px action of a MediaToolbar; `label` is both accessible name and default tooltip. Pass a 14px glyph (`className="icon-sm"`).
 * @group media
 * @use Each action inside MediaToolbar.
 * @avoid Outside a media toolbar: Button iconOnly.
 */
export function MediaToolbarButton({
  label,
  tone = "overlay",
  tooltip,
  ...props
}: IconActionProps) {
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
