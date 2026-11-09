/** An image restored from a stored transcript; structurally a session `Attachment`. */
type ImportedImage = {
  id: string;
  kind: "image";
  name: string;
  mimeType: string;
  data: string;
  size: number;
};

/**
 * Records in a stored session file that carry conversation content. The rest —
 * modes, file snapshots, queue operations, generated titles — is bookkeeping
 * the transcript never showed in the first place.
 */
export function isReplayableRecord(rec: Record<string, unknown>): boolean {
  const type = rec.type;
  if (type !== "user" && type !== "assistant") return false;
  // Subagent traffic is already represented by the Agent tool row on the
  // parent message; replaying it too would duplicate the work inline.
  return rec.isSidechain !== true;
}

/**
 * The prompt a person typed, or nothing when this record is a tool result
 * wearing the user role — those are answers to the agent's own calls and are
 * replayed through `handleLine` onto their tool rows instead.
 */
export function userPromptText(
  rec: Record<string, unknown>,
): { text: string; attachments: ImportedImage[] } | undefined {
  const message = rec.message as Record<string, unknown> | undefined;
  const content = message?.content;
  if (typeof content === "string")
    return content.trim() ? { text: content.trim(), attachments: [] } : undefined;
  if (!Array.isArray(content)) return undefined;
  const blocks = content as Array<Record<string, unknown>>;
  if (blocks.some((block) => block?.type === "tool_result")) return undefined;
  const attachments: ImportedImage[] = [];
  const markers: string[] = [];
  for (const block of blocks) {
    if (block?.type === "text") continue;
    const source = block?.source as Record<string, unknown> | undefined;
    if (
      block?.type === "image" &&
      source?.type === "base64" &&
      typeof source.data === "string" &&
      source.data.length > 0 &&
      typeof source.media_type === "string" &&
      ["image/png", "image/jpeg", "image/gif", "image/webp"].includes(source.media_type)
    ) {
      attachments.push({
        id: crypto.randomUUID(),
        kind: "image",
        name: `Imported image ${attachments.length + 1}`,
        mimeType: source.media_type,
        data: source.data,
        size: Math.max(
          0,
          Math.floor((source.data.length * 3) / 4) - (source.data.match(/=+$/)?.[0].length ?? 0),
        ),
      });
      // Saved transcript attachments intentionally omit inline payloads. Keep a
      // permanent marker as well so reopening never silently loses the image.
      markers.push(
        `[Imported image ${attachments.length}: embedded image unavailable in saved history]`,
      );
    } else {
      markers.push(
        `[Imported ${typeof block?.type === "string" ? block.type : "unsupported"} content is unavailable]`,
      );
    }
  }
  const text = [
    blocks
      .filter((block) => block?.type === "text")
      .map((block) => (typeof block.text === "string" ? block.text : ""))
      .join("\n")
      .trim(),
    ...markers,
  ]
    .filter(Boolean)
    .join("\n");
  return text || attachments.length ? { text, attachments } : undefined;
}

export function timestampOf(rec: Record<string, unknown>): number | undefined {
  const raw = rec.timestamp;
  if (typeof raw !== "string") return undefined;
  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? undefined : parsed;
}
