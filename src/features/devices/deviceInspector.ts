import type { DeviceInspection } from "./types";

/** Accessibility bounds are device pixels only when the platform advertises that space. */
export function hitTestDeviceNodes(nodes: DeviceInspection["nodes"], x: number, y: number) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return undefined;
  let best: DeviceInspection["nodes"][number] | undefined;
  let area = Number.POSITIVE_INFINITY;
  let actionable: DeviceInspection["nodes"][number] | undefined;
  let actionableArea = Number.POSITIVE_INFINITY;
  for (const node of nodes.slice(0, 2000)) {
    const bounds = node.bounds;
    if (
      !bounds ||
      ![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite) ||
      bounds.width <= 0 ||
      bounds.height <= 0
    )
      continue;
    if (x < bounds.x || y < bounds.y || x > bounds.x + bounds.width || y > bounds.y + bounds.height)
      continue;
    const nextArea = bounds.width * bounds.height;
    if (node.enabled && node.clickable && nextArea < actionableArea) {
      actionable = node;
      actionableArea = nextArea;
    }
    if (nextArea < area || (nextArea === area && node.clickable && !best?.clickable)) {
      best = node;
      area = nextArea;
    }
  }
  return actionable ?? best;
}
