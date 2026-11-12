import { useDecorativeMotionEnabled } from "../../features/settings/model/decorativeMotion";
import { optionalTextAttributes, type TextRoles } from "./Text";

const LINE_CLAMP = { 1: "line-clamp-1", 2: "line-clamp-2", 3: "line-clamp-3" } as const;

export type ParticleTextProps = Pick<TextRoles, "size" | "tone" | "weight" | "leading"> & {
  text: string;
  /** Placement only (margin, width); type roles are props. */
  className?: string;
  /** Clamp the title to this many lines with an ellipsis. Unset lets it wrap as before. */
  lines?: 1 | 2 | 3;
};

/**
 * Title text that settles in briefly when it changes (CSS only, no canvas); static when decorative motion is off.
 * Fills the remaining width of a flex row. Size, ink, weight and line height are Text roles; unset roles inherit.
 * @group text
 * @use A session or view title whose text changes and should softly re-enter.
 * @avoid Ordinary static text or headings. Do not add continuous or canvas text effects.
 * @example <ParticleText text={title} size="secondary" tone="primary" weight="medium" leading="snug" lines={1} />
 */
export function ParticleText({
  text,
  className = "",
  size,
  tone,
  weight,
  leading,
  lines,
}: ParticleTextProps) {
  const motionEnabled = useDecorativeMotionEnabled();
  const classes =
    `min-w-0 flex-1 ${motionEnabled ? "bycoda-title-settle" : ""} ${lines ? LINE_CLAMP[lines] : ""} ${className}`
      .replace(/\s+/g, " ")
      .trim();
  return (
    <span className="relative flex min-w-0 flex-1">
      <span key={text} {...optionalTextAttributes({ size, tone, weight, leading }, classes)}>
        {text}
      </span>
    </span>
  );
}
