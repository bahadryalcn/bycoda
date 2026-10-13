import type { ToolPreview } from "./session";

/** Retained tool input, independent of the current file or Git working tree. */
export type ToolInspection = {
  kind: "diff" | "content" | "command";
  text: string;
  truncated?: boolean;
};

export const MAX_TOOL_INSPECTION_CHARS = 24_000;

export function retainToolInspection(kind: ToolInspection["kind"], text: string): ToolInspection {
  if (text.length <= MAX_TOOL_INSPECTION_CHARS) return { kind, text };
  return { kind, text: text.slice(0, MAX_TOOL_INSPECTION_CHARS), truncated: true };
}

/** Validate history/remote payloads as well as newly captured provider data. */
export function boundedToolPreview(
  preview: ToolPreview | undefined,
  max = MAX_TOOL_INSPECTION_CHARS,
): ToolPreview | undefined {
  if (!preview || preview.inspection === undefined) return preview;
  const value = preview.inspection as unknown;
  const { inspection: _inspection, ...rest } = preview;
  if (!value || typeof value !== "object") return rest;
  const row = value as Record<string, unknown>;
  if (
    (row.kind !== "diff" && row.kind !== "content" && row.kind !== "command") ||
    typeof row.text !== "string"
  )
    return rest;
  return {
    ...rest,
    inspection: {
      kind: row.kind,
      text: row.text.slice(0, max),
      ...(row.truncated === true || row.text.length > max ? { truncated: true } : {}),
    },
  };
}
