const PLACEMENT = ["left", "top", "width", "height"];

/**
 * Copies where the shared artwork sits from a layout leaf (`data-pane-background`)
 * onto the pane's artwork layer. Written on the leaf itself the properties would
 * be inherited by the whole pane, and a divider drag would restyle every transcript
 * row on each frame. Both sides call this: the pane tree after a layout change,
 * the pane when its layer mounts.
 */
export function syncPaneBackground(
  leaf: HTMLElement | null | undefined,
  layer = leaf?.querySelector<HTMLElement>(".chat-pane-background"),
) {
  const values = leaf?.dataset.paneBackground?.split(" ");
  if (!values || !layer) return;
  PLACEMENT.forEach((side, index) => {
    const name = `--chat-background-${side}`;
    if (layer.style.getPropertyValue(name) !== values[index])
      layer.style.setProperty(name, values[index]);
  });
}

/** Left, top, width and height of the shared artwork relative to one pane of the tree. */
export function paneBackgroundPlacement(rect: { x: number; y: number; w: number; h: number }) {
  return [-rect.x / rect.w, -rect.y / rect.h, 1 / rect.w, 1 / rect.h]
    .map((value) => `${value * 100}%`)
    .join(" ");
}

/** Syncs every leaf of a pane tree. */
export function syncPaneBackgrounds(tree: HTMLElement | null) {
  for (const leaf of tree?.querySelectorAll<HTMLElement>(":scope > [data-pane-leaf]") ?? [])
    syncPaneBackground(leaf);
}
