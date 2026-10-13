import { useId, type CSSProperties } from "react";
import { MASCOT_GRID, projectMascot } from "../model/projectMascots";
import { useDecorativeMotionEnabled } from "../../settings/model/decorativeMotion";

type Props = {
  project: string;
  /** Optional project color; otherwise use the symbol's own palette. */
  color?: string;
  /** Explicit pick from the project menu; falls back to the hashed one. */
  name?: string | null;
  className?: string;
  /** Gently breathes while work is in flight, subject to motion preferences. */
  active?: boolean;
};

const CODE_ROWS = Array.from({ length: 19 }, (_, row) => ({
  y: 1.3 + row * 1.25,
  text: ["const<>();{}[]", "01=>let:{};/", "</>run(x);01"][row % 3].repeat(3),
}));

/** Actual code glyphs clipped to a recognizable project silhouette. */
export function ProjectMascot({
  project,
  color,
  name,
  className = "size-3 shrink-0",
  active = false,
}: Props) {
  const mascot = projectMascot(project, name);
  const id = useId().replace(/:/g, "");
  const clipId = `project-code-${id}`;
  const gradientId = `project-color-${id}`;
  const motionEnabled = useDecorativeMotionEnabled();
  const animate = active && motionEnabled;
  return (
    <svg
      aria-hidden
      viewBox={`0 0 ${MASCOT_GRID} ${MASCOT_GRID}`}
      className={`project-sigil ${className} ${animate ? "bycoda-sigil-active" : ""}`}
      data-project-icon={mascot.name}
      data-project-icon-label={mascot.label}
      style={
        {
          color: color ?? mascot.color,
          "--sigil-hi": color ? `color-mix(in oklch, ${color} 70%, white)` : mascot.highlight,
        } as CSSProperties
      }
    >
      <defs>
        <clipPath id={clipId}>
          <path d={mascot.restPath} clipRule="evenodd" />
        </clipPath>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" className="project-sigil-ink-a" />
          <stop offset=".5" className="project-sigil-ink-hi" />
          <stop offset="1" className="project-sigil-ink-a" />
        </linearGradient>
      </defs>
      <path d={mascot.restPath} className="project-sigil-base" fillRule="evenodd" />
      <g
        clipPath={`url(#${clipId})`}
        fill={`url(#${gradientId})`}
        fontFamily="monospace"
        fontSize="1.75"
        fontWeight="700"
      >
        {CODE_ROWS.map(({ y, text }, row) => (
          <text
            key={row}
            x={row % 2 ? -0.3 : 0}
            y={y}
            textLength="32"
            lengthAdjust="spacingAndGlyphs"
            xmlSpace="preserve"
          >
            {text}
          </text>
        ))}
      </g>
    </svg>
  );
}
