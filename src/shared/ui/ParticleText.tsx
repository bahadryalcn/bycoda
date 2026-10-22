import { useDecorativeMotionEnabled } from "../../features/settings/model/decorativeMotion";

/** A brief title settle, without canvas effects or continuous animation. */
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
