import { TreeRow as ArcTreeRow, type TreeRowProps } from "./arc/tree-view/tree-row";
export type { TreeRowProps } from "./arc/tree-view/tree-row";
/** Shared presentation; the feature owns tree selection, expansion, rename and drop. */
export function TreeRow(props: TreeRowProps) {
  return <ArcTreeRow {...props} />;
}
