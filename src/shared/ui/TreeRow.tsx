import {
  TreeRow as ArcTreeRow,
  TreeRowIcon as ArcTreeRowIcon,
  TreeRowLabel as ArcTreeRowLabel,
  TreeRowToggle as ArcTreeRowToggle,
  TreeRowTrailing as ArcTreeRowTrailing,
  type TreeRowProps,
} from "./arc/tree-view/tree-row";
export type { TreeRowProps } from "./arc/tree-view/tree-row";
/** Shared presentation; the feature owns tree selection, expansion, rename and drop. */
export function TreeRow(props: TreeRowProps) {
  return <ArcTreeRow {...props} />;
}
/** Optional row slots: `TreeRowToggle`, `TreeRowIcon`, `TreeRowLabel`, `TreeRowTrailing`. */
export const TreeRowToggle = ArcTreeRowToggle;
export const TreeRowIcon = ArcTreeRowIcon;
export const TreeRowLabel = ArcTreeRowLabel;
export const TreeRowTrailing = ArcTreeRowTrailing;
