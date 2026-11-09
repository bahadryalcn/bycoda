import { useDecorativeMotionEnabled } from "../../features/settings/model/decorativeMotion";

/**
 * Title text that settles in briefly when it changes (CSS only, no canvas); static when decorative motion is off.
 * Fills the remaining width of a flex row.
 * @group text
 * @use A session or view title whose text changes and should softly re-enter.
 * @avoid Ordinary static text or headings. Do not add continuous or canvas text effects.
 */
export function ParticleText({ text, className = "" }: { text: string; className?: string }) {
  const motionEnabled = useDecorativeMotionEnabled();
  return (
    <span className="relative flex min-w-0 flex-1">
      <span
        key={text}
        className={`min-w-0 flex-1 ${motionEnabled ? "bycoda-title-settle" : ""} ${className}`.trim()}
      >
        {text}
      </span>
    </span>
  );
}
