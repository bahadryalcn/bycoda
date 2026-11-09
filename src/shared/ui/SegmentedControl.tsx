import ArcSegmentedControl, {
  type SegmentedControlProps,
} from "./arc/segmented-control/segmented-control";

export type { SegmentedControlProps, Segment } from "./arc/segmented-control/segmented-control";

/**
 * Compact joined buttons for one exclusive choice, with radio semantics and arrow-key navigation.
 * The caller owns the value and search/navigation IDs.
 * @group choice
 * @use Pick a mode, filter or display option that changes one content area (list/grid, scope).
 * @avoid Form choice with descriptions: RadioGroup. Switching between views or panels: Tabs. Many options: Select.
 * @arc segmented-control
 */
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
