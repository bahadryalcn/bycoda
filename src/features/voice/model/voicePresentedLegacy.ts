type Loose = Record<string, unknown>;
const record = (value: unknown): value is Loose =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

function legacyBlock(block: unknown, title: unknown): unknown {
  if (!record(block) || typeof block.kind !== "string" || "type" in block) return block;
  const { kind, ...rest } = block;
  switch (kind) {
    case "text":
      return { type: "Text", ...rest };
    case "notes":
      return { type: "List", ...rest };
    case "comparison":
      return { type: "DescriptionList", ...rest };
    case "chart":
      return { type: "BarChart", label: title, ...rest };
    case "copy":
      return { type: "CopyBlock", ...rest };
    case "actions":
      return {
        type: "Stack",
        direction: "row",
        children: Array.isArray(rest.items)
          ? rest.items.map((item: unknown) => {
              if (!record(item)) return item;
              const { label, ...action } = item;
              return { type: "Button", label, action };
            })
          : rest.items,
      };
    default:
      return block;
  }
}

/**
 * Earlier calls sent one `content` block or `blocks` of kinds (`text`, `notes`, `comparison`,
 * `chart`, `copy`, `actions`). Each maps onto the component of the same meaning, so there is one
 * view format to validate and draw.
 */
export function normalizeLegacyPresentedInput(input: unknown): unknown {
  if (!record(input)) return input;
  let next = input;
  if ("content" in next && !("blocks" in next)) {
    const { content, ...rest } = next;
    next = { ...rest, blocks: [content] };
  }
  if (!Array.isArray(next.blocks)) return next;
  return { ...next, blocks: next.blocks.map((block) => legacyBlock(block, next.title)) };
}
