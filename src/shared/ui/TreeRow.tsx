import {
  TreeRow as ArcTreeRow,
  TreeRowIcon as ArcTreeRowIcon,
  TreeRowLabel as ArcTreeRowLabel,
  TreeRowToggle as ArcTreeRowToggle,
  TreeRowTrailing as ArcTreeRowTrailing,
  type TreeRowProps,
} from "./arc/tree-view/tree-row";
export type { TreeRowProps } from "./arc/tree-view/tree-row";
/**
 * One tree row with indent, toggle, icon, label and trailing slots at shared density. Presentation only; the
 * feature owns selection, expansion, rename and drop.
 * @group data
 * @use Row of a file or hierarchy tree.
 * @avoid Flat lists and menus: Button item or MenuRow. Collapsible section: Disclosure. Flat growing collections with continuation: ContinuousList.
 * @arc tree-view
 */
export function TreeRow(props: TreeRowProps) {
  return <ArcTreeRow {...props} />;
}
/**
 * Expand/collapse chevron slot of a TreeRow.
 * @status internal
 * @group data
 * @use Expansion control inside TreeRow.
 * @avoid The complete hierarchical row: TreeRow.
 */
export const TreeRowToggle = ArcTreeRowToggle;
/**
 * Leading icon slot of a TreeRow.
 * @status internal
 * @group data
 * @use Leading icon slot inside TreeRow.
 * @avoid The complete hierarchical row: TreeRow.
 */
export const TreeRowIcon = ArcTreeRowIcon;
/**
 * Label slot of a TreeRow.
 * @status internal
 * @group data
 * @use Main text slot inside TreeRow.
 * @avoid The complete hierarchical row: TreeRow.
 */
export const TreeRowLabel = ArcTreeRowLabel;
/**
 * Trailing slot (badge, actions) of a TreeRow.
 * @status internal
 * @group data
 * @use Trailing content slot inside TreeRow.
 * @avoid The complete hierarchical row: TreeRow.
 */
export const TreeRowTrailing = ArcTreeRowTrailing;
