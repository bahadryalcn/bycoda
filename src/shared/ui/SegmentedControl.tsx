import ArcSegmentedControl, {
  type SegmentedControlProps,
} from "./arc/segmented-control/segmented-control";

export type { SegmentedControlProps, Segment } from "./arc/segmented-control/segmented-control";

/**
 * Compact joined buttons for one exclusive choice, with radio semantics and arrow-key navigation.
 * The caller owns the value and search/navigation IDs.
 * @group choice
 * @use Adjust one content area's filter, presentation (list/grid) or short immediate setting; options change the same content or value.
 * @avoid Navigate to a different tool, section or editor (including Preview/Source): Tabs or TabStrip. Named form submission, required validation or described choices: RadioGroup. Many options: Select.
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
