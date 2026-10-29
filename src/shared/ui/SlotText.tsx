import ArcSlotText, { type SlotTextProps } from "./arc/slot-text/slot-text";
import { useDecorativeMotionEnabled } from "../../features/settings/model/decorativeMotion";
export type { SlotTextProps } from "./arc/slot-text/slot-text";
/** Exact formatted text remains the accessible value; animation is decorative. */
export function SlotText({
  className,
  duration = 0.35,
  stagger = 0.015,
  spins = 0,
  motion,
  ...props
}: SlotTextProps) {
  // Reels are decorative: the application motion preference applies unless the caller decides.
  const decorative = useDecorativeMotionEnabled();
  return (
    <ArcSlotText
      {...props}
      motion={motion ?? (decorative ? "auto" : "none")}
      duration={duration}
      stagger={stagger}
      spins={spins}
      className={["bycoda-arc", className].filter(Boolean).join(" ")}
    />
  );
}
