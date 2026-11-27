import { paneBackgroundPlacement, syncPaneBackgrounds } from "../../../shared/lib/paneBackground";
import {
  layoutLeaves,
  layoutSashes,
  type LayoutNode,
  type LayoutRect,
  type LayoutSash,
} from "../model/layout";

/** CSS percent of a 0–1 fraction, rounded so float noise (15.000000000000002%) never reaches the style. */
const percent = (fraction: number) => `${Number((fraction * 100).toFixed(6))}%`;

/** Percent box of a pane; React renders it and a sash drag writes it directly. */
export function paneRectStyle(rect: LayoutRect) {
  return {
    left: percent(rect.x),
    top: percent(rect.y),
    width: percent(rect.w),
    height: percent(rect.h),
  };
}

export function sashStyle(sash: LayoutSash) {
  const { group, sizes, index } = sash;
  const boundary = sizes.slice(0, index + 1).reduce((sum, size) => sum + size, 0);
  return sash.dir === "right"
    ? {
        left: percent(group.x + boundary * group.w),
        top: percent(group.y),
        height: percent(group.h),
      }
    : {
        left: percent(group.x),
        top: percent(group.y + boundary * group.h),
        width: percent(group.w),
      };
}

export const sashKey = (sash: Pick<LayoutSash, "splitId" | "index">) =>
  `${sash.splitId}:${sash.index}`;

/** Accessible name naming the two neighbouring tracks and the split's size, so repeated sashes stay distinct. */
export function paneSashLabel(
  sash: LayoutSash,
  t: (message: string, values?: Record<string, unknown>) => string,
) {
  const values = { p0: sash.index + 1, p1: sash.index + 2, p2: sash.sizes.length };
  return sash.dir === "right"
    ? t("Resize between column {p0} and column {p1} of {p2}", values)
    : t("Resize between row {p0} and row {p1} of {p2}", values);
}

/**
 * Writes a layout's pane and sash boxes straight onto the tree's elements. A sash
 * drag runs this per frame instead of re-rendering the tree; React renders the
 * committed layout with the same functions, so nothing jumps when it takes over.
 */
export function writeLayoutPreview(tree: HTMLElement | null, node: LayoutNode) {
  if (!tree) return;
  const panes = new Map<string, HTMLElement>();
  const sashes = new Map<string, HTMLElement>();
  for (const child of tree.children) {
    if (!(child instanceof HTMLElement)) continue;
    if (child.dataset.paneLeaf) panes.set(child.dataset.paneLeaf, child);
    else if (child.dataset.paneSash) sashes.set(child.dataset.paneSash, child);
  }
  for (const pane of layoutLeaves(node))
    for (const id of pane.tabIds ?? [pane.id]) {
      const element = panes.get(id);
      if (!element) continue;
      Object.assign(element.style, paneRectStyle(pane.rect));
      element.dataset.paneBackground = paneBackgroundPlacement(pane.rect);
    }
  for (const sash of layoutSashes(node)) {
    const element = sashes.get(sashKey(sash));
    if (element) Object.assign(element.style, sashStyle(sash));
  }
  syncPaneBackgrounds(tree);
}
