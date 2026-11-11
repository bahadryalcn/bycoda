import { paneBackgroundPlacement, syncPaneBackgrounds } from "../../../shared/lib/paneBackground";
import {
  layoutLeaves,
  layoutSashes,
  type LayoutNode,
  type LayoutRect,
  type LayoutSash,
} from "../model/layout";

/** Percent box of a pane; React renders it and a sash drag writes it directly. */
export function paneRectStyle(rect: LayoutRect) {
  return {
    left: `${rect.x * 100}%`,
    top: `${rect.y * 100}%`,
    width: `${rect.w * 100}%`,
    height: `${rect.h * 100}%`,
  };
}

export function sashStyle(sash: LayoutSash) {
  const { group, sizes, index } = sash;
  const boundary = sizes.slice(0, index + 1).reduce((sum, size) => sum + size, 0);
  return sash.dir === "right"
    ? {
        left: `${(group.x + boundary * group.w) * 100}%`,
        top: `${group.y * 100}%`,
        height: `${group.h * 100}%`,
      }
    : {
        left: `${group.x * 100}%`,
        top: `${(group.y + boundary * group.h) * 100}%`,
        width: `${group.w * 100}%`,
      };
}

export const sashKey = (sash: Pick<LayoutSash, "splitId" | "index">) =>
  `${sash.splitId}:${sash.index}`;

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
