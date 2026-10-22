import ArcSlotText, { type SlotTextProps } from "./arc/slot-text/slot-text";
export type { SlotTextProps } from "./arc/slot-text/slot-text";
/** Exact formatted text remains the accessible value; animation is decorative. */
export function SlotText({
  className,
  duration = 0.35,
  stagger = 0.015,
  spins = 0,
  ...props
}: SlotTextProps) {
  return (
    <ArcSlotText
      {...props}
      duration={duration}
      stagger={stagger}
      spins={spins}
      className={["bycoda-arc", className].filter(Boolean).join(" ")}
    />
  );
}
