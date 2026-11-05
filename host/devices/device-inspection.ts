import { androidSnapshotNodes } from "./android-device-control";
import { createHash } from "node:crypto";
import { truncateGraphemes } from "../../src/shared/lib/text/truncate";

export type InspectionNode = {
  id: string;
  label: string;
  role: string;
  identity: string;
  bounds: { x: number; y: number; width: number; height: number };
  enabled: boolean;
  clickable: boolean;
};

/** Preserve XML parentage; visual overlap is not evidence of ancestry. */
function androidParents(xml: string): Array<number | undefined> {
  const markup = xml.replace(/<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>/g, "");
  const parents: Array<number | undefined> = [];
  const stack: number[] = [];
  const tags = /<\/node\s*>|<node\s+((?:[^>"']|"[^"]*"|'[^']*')*)\s*\/?\s*>/g;
  for (const match of markup.matchAll(tags)) {
    if (match[0].startsWith("</")) {
      if (!stack.length) throw new Error("DEVICE_SNAPSHOT_INVALID_HIERARCHY");
      stack.pop();
      continue;
    }
    if (parents.length >= 500 || stack.length >= 64)
      throw new Error("DEVICE_INSPECTION_TOO_MANY_NODES");
    const index = parents.length;
    parents.push(stack.at(-1));
    if (!/\/\s*>$/.test(match[0])) stack.push(index);
  }
  if (stack.length) throw new Error("DEVICE_SNAPSHOT_INVALID_HIERARCHY");
  return parents;
}

export function inspectionFingerprint(raw: string): string {
  const parsed = JSON.parse(raw) as {
    data?: { xml?: unknown; nodes?: unknown; snapshot?: { nodes?: unknown } };
  };
  const tree = parsed.data?.xml ?? parsed.data?.nodes ?? parsed.data?.snapshot?.nodes;
  if (tree === undefined) throw new Error("DEVICE_INSPECTION_UNSUPPORTED");
  return createHash("sha256").update(JSON.stringify(tree)).digest("hex");
}

/** Normalize only finite, bounded geometry; leave the original output intact. */
export function inspectionNodes(raw: string): InspectionNode[] {
  if (Buffer.byteLength(raw, "utf8") > 512 * 1024) throw new Error("DEVICE_SNAPSHOT_TOO_LARGE");
  const parsed = JSON.parse(raw) as {
    success?: boolean;
    data?: { xml?: string; nodes?: unknown; snapshot?: { nodes?: unknown } };
  };
  if (parsed.success === false) throw new Error("DEVICE_SNAPSHOT_FAILED");
  const nodes: unknown =
    typeof parsed.data?.xml === "string"
      ? (() => {
          const android = androidSnapshotNodes(parsed.data.xml);
          const parents = androidParents(parsed.data.xml);
          if (android.length !== parents.length)
            throw new Error("DEVICE_SNAPSHOT_INVALID_HIERARCHY");
          const inherited = new Map<number, string[]>();
          for (let i = 0; i < android.length; i++) {
            const source = android[i];
            if (source.clickable || !source.enabled || !source.label?.trim()) continue;
            for (let parent = parents[i]; parent !== undefined; parent = parents[parent]) {
              const target = android[parent];
              if (!target.enabled) break;
              if (!target.clickable) continue;
              if (!target.label?.trim()) {
                const labels = inherited.get(parent) ?? [];
                const label = truncateGraphemes(source.label.trim(), 300);
                if (labels.length < 3 && !labels.includes(label)) labels.push(label);
                inherited.set(parent, labels);
              }
              break;
            }
          }
          return android.map((node, index) => {
            const match = /^\[(\d+),(\d+)\]\[(\d+),(\d+)\]$/.exec(node.bounds ?? "");
            return {
              label: node.label,
              displayLabel: node.label?.trim() ? node.label : inherited.get(index)?.join(" · "),
              parentIndex: parents[index],
              type: node.className,
              enabled: node.enabled,
              hittable: node.clickable,
              identifier: node.resourceId,
              text: node.text,
              contentDescription: node.contentDescription,
              rect: match
                ? {
                    x: Number(match[1]),
                    y: Number(match[2]),
                    width: Number(match[3]) - Number(match[1]),
                    height: Number(match[4]) - Number(match[2]),
                  }
                : undefined,
            };
          });
        })()
      : (parsed.data?.nodes ?? parsed.data?.snapshot?.nodes);
  if (!Array.isArray(nodes)) throw new Error("DEVICE_INSPECTION_UNSUPPORTED");
  if (nodes.length > 500) throw new Error("DEVICE_INSPECTION_TOO_MANY_NODES");
  return nodes.flatMap((value, index) => {
    if (!value || typeof value !== "object") return [];
    const node = value as {
      label?: unknown;
      displayLabel?: unknown;
      parentIndex?: unknown;
      type?: unknown;
      kind?: unknown;
      identifier?: unknown;
      text?: unknown;
      contentDescription?: unknown;
      enabled?: unknown;
      hittable?: unknown;
      rect?: { x?: unknown; y?: unknown; width?: unknown; height?: unknown };
    };
    const rect = node.rect;
    if (
      !rect ||
      ![rect.x, rect.y, rect.width, rect.height].every(
        (n) => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 20000,
      ) ||
      !rect.width ||
      !rect.height
    )
      return [];
    if (Number(rect.x) + Number(rect.width) > 20000 || Number(rect.y) + Number(rect.height) > 20000)
      return [];
    const identity = createHash("sha256")
      .update(
        JSON.stringify([
          node.identifier,
          node.text,
          node.contentDescription,
          node.label,
          node.type,
          node.kind,
          node.parentIndex,
        ]),
      )
      .digest("hex");
    return [
      {
        id: String(index),
        label:
          typeof node.displayLabel === "string"
            ? truncateGraphemes(node.displayLabel, 300)
            : typeof node.label === "string"
              ? truncateGraphemes(node.label, 300)
              : "",
        role: truncateGraphemes(String(node.type ?? node.kind ?? ""), 200),
        identity,
        bounds: rect as InspectionNode["bounds"],
        enabled: node.enabled !== false,
        clickable: node.hittable === true,
      },
    ];
  });
}
