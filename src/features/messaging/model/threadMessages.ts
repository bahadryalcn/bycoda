import type { ThreadMessage } from "./messagingTypes";

/** Oldest first; equal times keep the provider's order. */
export function sortThreadMessages(messages: readonly ThreadMessage[]): ThreadMessage[] {
  return messages
    .map((message, index) => ({ message, index }))
    .sort((a, b) => (a.message.at || 0) - (b.message.at || 0) || a.index - b.index)
    .map(({ message }) => message);
}

/** Adds a sent message once; a later reload may already contain it. */
export function appendThreadMessage(
  messages: readonly ThreadMessage[],
  message: ThreadMessage,
): ThreadMessage[] {
  if (messages.some((entry) => entry.id === message.id)) return [...messages];
  return sortThreadMessages([...messages, message]);
}

/** The loaded part of one conversation: `earlier` continues toward older messages, null at the start. */
export type ThreadPageState = {
  messages: ThreadMessage[];
  earlier: string | null;
};

function sameMessage(a: ThreadMessage, b: ThreadMessage): boolean {
  return (
    a.author === b.author &&
    a.authorAddress === b.authorAddress &&
    a.body === b.body &&
    a.at === b.at &&
    a.outbound === b.outbound &&
    a.attachments.length === b.attachments.length &&
    a.attachments.every(
      (attachment, index) =>
        attachment.name === b.attachments[index].name && attachment.size === b.attachments[index].size,
    )
  );
}

/**
 * Messages by id, oldest first; a message in `incoming` replaces the loaded copy (an edit). An
 * unchanged one keeps the loaded object, so rows built from it are not rebuilt by a refresh.
 */
function mergeMessages(
  loaded: readonly ThreadMessage[],
  incoming: readonly ThreadMessage[],
): ThreadMessage[] {
  const byId = new Map<string, ThreadMessage>();
  for (const message of loaded) byId.set(message.id, message);
  for (const message of incoming) {
    const existing = byId.get(message.id);
    if (!existing || !sameMessage(existing, message)) byId.set(message.id, message);
  }
  return sortThreadMessages([...byId.values()]);
}

/**
 * Folds a freshly fetched newest page into what is loaded, so a refresh never drops the earlier
 * pages the reader opened or a sent message the provider does not list yet. The cursor to older
 * messages is the page's own only when the page reaches the oldest loaded message.
 */
export function refreshThreadPage(
  loaded: ThreadPageState | null,
  page: { messages: readonly ThreadMessage[]; earlier?: string | null },
): ThreadPageState {
  const earlier = page.earlier ?? null;
  if (!loaded || loaded.messages.length === 0) {
    return { messages: sortThreadMessages(page.messages), earlier };
  }
  const messages = mergeMessages(loaded.messages, page.messages);
  const oldest = messages[0].id;
  return {
    messages,
    earlier: page.messages.some((message) => message.id === oldest) ? earlier : loaded.earlier,
  };
}

/**
 * Prepends a page of older messages. Null when the page answers a cursor the conversation has
 * since moved past (a reload replaced it), so a late response never rewinds newer state.
 */
export function extendThreadPage(
  loaded: ThreadPageState,
  cursor: string,
  page: { messages: readonly ThreadMessage[]; earlier?: string | null },
): ThreadPageState | null {
  if (loaded.earlier !== cursor) return null;
  return {
    messages: mergeMessages(page.messages, loaded.messages),
    earlier: page.earlier ?? null,
  };
}

/** Whether the reader is close enough to the end of the conversation to keep following new messages. */
export function isAtThreadEnd(metrics: {
  scrollHeight: number;
  scrollTop: number;
  clientHeight: number;
}): boolean {
  return metrics.scrollHeight - metrics.scrollTop - metrics.clientHeight < 64;
}

/** The address an email reply goes to: the newest inbound sender with a known address. */
export function emailReplyAddress(messages: readonly ThreadMessage[] | null): string | null {
  if (!messages) return null;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message.outbound && message.authorAddress?.trim()) return message.authorAddress.trim();
  }
  return null;
}
