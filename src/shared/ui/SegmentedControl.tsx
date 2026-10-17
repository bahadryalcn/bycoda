import ArcSegmentedControl, {
  type SegmentedControlProps,
} from "./arc/segmented-control/segmented-control";

export type { SegmentedControlProps, Segment } from "./arc/segmented-control/segmented-control";

/** Exclusive visible modes. The caller owns value and search/navigation IDs. */
export function SegmentedControl({
  className,
  selectionRole = "radio",
  ...props
}: SegmentedControlProps) {
  return (
    <ArcSegmentedControl
      {...props}
      selectionRole={selectionRole}
      className={["bycoda-arc bycoda-arc-segmented", className].filter(Boolean).join(" ")}
    />
  );
}
