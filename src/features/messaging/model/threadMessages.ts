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

/** The address an email reply goes to: the newest inbound sender with a known address. */
export function emailReplyAddress(messages: readonly ThreadMessage[] | null): string | null {
  if (!messages) return null;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message.outbound && message.authorAddress?.trim()) return message.authorAddress.trim();
  }
  return null;
}
