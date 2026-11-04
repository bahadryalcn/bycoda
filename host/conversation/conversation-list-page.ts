export const PAGED_CONVERSATION_LISTS = new Set([
  "crews.list",
  "tasks.list",
  "terminals.list",
  "logs.monitors.list",
  "machines.list",
  "devServers.list",
  "devices.list",
]);
export function conversationListArguments(action: string, input: Record<string, unknown>) {
  if (!PAGED_CONVERSATION_LISTS.has(action)) return input;
  const { offset: _offset, limit: _limit, ...rest } = input;
  return rest;
}
/** Legacy native owners retain exact arguments; pagination bounds the model-facing result. */
export function pageConversationListResult(
  action: string,
  input: Record<string, unknown>,
  result: unknown,
) {
  if (!PAGED_CONVERSATION_LISTS.has(action)) return result;
  const offset = Number(input.offset ?? 0),
    limit = Number(input.limit ?? 30);
  const page = (rows: unknown[]) => ({
    items: rows.slice(offset, offset + limit),
    total: rows.length,
    nextOffset: offset + limit < rows.length ? offset + limit : null,
  });
  if (Array.isArray(result)) return page(result);
  if (!result || typeof result !== "object") return result;
  const value = { ...result } as Record<string, unknown>;
  const pagination: Record<string, { total: number; nextOffset: number | null }> = {};
  for (const [key, field] of Object.entries(value))
    if (Array.isArray(field)) {
      const { items, ...metadata } = page(field);
      value[key] = items;
      pagination[key] = metadata;
    }
  return { ...value, pagination };
}
