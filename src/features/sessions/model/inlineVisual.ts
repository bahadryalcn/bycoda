/** Portable, conversation-owned data. Never a path, live URL or native capability. */
export type InlineVisualSnapshot = {
  version: 1;
  title: string;
  html: string;
  height: number;
};

// Leave room for provider JSON envelopes under the retained 8,000 character limit.
export const MAX_INLINE_VISUAL_CHARS = 4000;
export function isInlineVisualRenderTool(title: string | undefined): boolean {
  return /(?:^|[\s:])(?:mcp__[^\s]+__)?conversation_visuals_render(?:$|\s|\()/.test(title ?? "");
}
export function inlineVisualSnapshot(value: unknown): InlineVisualSnapshot | undefined {
  if (!value || typeof value !== "object") return;
  const item = value as Record<string, unknown>;
  if (item.version !== 1 || typeof item.title !== "string" || !item.title.trim() ||
      item.title.length > 160 || typeof item.html !== "string" || !item.html.trim() ||
      item.html.includes("\0") || typeof item.height !== "number" ||
      !Number.isInteger(item.height) || item.height < 160 || item.height > 720) return;
  const snapshot: InlineVisualSnapshot = {
    version: 1, title: item.title, html: item.html, height: item.height,
  };
  if (JSON.stringify(snapshot).length > MAX_INLINE_VISUAL_CHARS) return;
  return snapshot;
}

/** MCP text and structured results vary by provider. Ordinary HTML is never executed. */
export function inlineVisualFromResult(detail: string | undefined): InlineVisualSnapshot | undefined {
  if (!detail || detail.length > 8000) return;
  function read(value: unknown, depth: number): InlineVisualSnapshot | undefined {
    if (depth > 8 || value == null) return;
    if (typeof value === "string") {
      try { return read(JSON.parse(value), depth + 1); } catch { return; }
    }
    if (Array.isArray(value)) {
      for (const part of value) { const found = read(part, depth + 1); if (found) return found; }
      return;
    }
    if (typeof value !== "object") return;
    const record = value as Record<string, unknown>;
    if (record.isError === true) return;
    const snapshot = inlineVisualSnapshot(record.bycodaInlineVisual);
    if (snapshot) return snapshot;
    for (const key of ["content", "text", "result", "structuredContent"]) {
      const found = read(record[key], depth + 1); if (found) return found;
    }
  }
  return read(detail, 0);
}

/** A stricter policy than file previews: self-contained content cannot contact a host. */
export function sandboxedInlineVisual(source: string, dark: boolean): string {
  return `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"><meta name="color-scheme" content="${dark ? "dark" : "light"}">${source}`;
}
