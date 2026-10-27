import type { Session } from "./session";
import { modelContextWindow } from "./models";

export type HandoffHistoryMessage = {
  id: string;
  role: "user" | "assistant" | "plan" | "tasks";
  text: string;
};
export type HandoffHistory = { sessionId: string; messages: HandoffHistoryMessage[] };
export type BudgetedHandoff = {
  text: string;
  selectedIds: string[];
  omittedIds: string[];
  estimatedTokens: number;
  budgetTokens: number;
  history: HandoffHistory;
  /** Non-blocking transcript notice when even the archive reference cannot fit. */
  notice?: string;
};

/** Conservative heuristic, not a tokenizer: at least one token per code point,
 * or one per two UTF-8 bytes. Turkish letters are not charged twice simply for
 * using two bytes. The provider remains authoritative about actual limits. */
export function handoffTokenEstimate(text: string): number {
  return Math.max(Array.from(text).length, Math.ceil(new TextEncoder().encode(text).length / 2));
}

export function handoffHistory(session: Session): HandoffHistory {
  return {
    sessionId: session.id,
    messages: session.blocks.flatMap((block) =>
      ["user", "assistant", "plan", "tasks"].includes(block.role) && block.text.trim()
        ? [{ id: block.id, role: block.role as HandoffHistoryMessage["role"], text: block.text }]
        : [],
    ),
  };
}

export function buildBudgetedHandoff(
  session: Session,
  options: {
    contextWindow?: number;
    request?: string;
    brief?: string;
    historyPath?: string;
    reservedTokens?: number;
  } = {},
): BudgetedHandoff {
  const history = handoffHistory(session);
  const window =
    Number.isFinite(options.contextWindow) && (options.contextWindow ?? 0) > 0
      ? Math.floor(options.contextWindow!)
      : modelContextWindow(session.model, session.harness);
  // Bound response headroom rather than reserving 40% on top of a conservative
  // input estimate. Handoff is optional; the owner's request is never clipped.
  const reserve = Math.max(512, options.reservedTokens ?? Math.min(8192, Math.floor(window * 0.1)));
  const budgetTokens = Math.max(
    0,
    Math.min(24_000, window - reserve - handoffTokenEstimate(options.request ?? "")),
  );
  const limit = budgetTokens;
  const clip = (value: string, tokens: number): string => {
    let result = "";
    let used = 0;
    for (const char of value) {
      const size = handoffTokenEstimate(char);
      if (used + size > tokens) break;
      result += char;
      used += size;
    }
    return result;
  };
  const readback = options.historyPath
    ? `Earlier conversation is saved on this host at ${JSON.stringify(options.historyPath)}. Read that JSON file when omitted decisions are needed; message ids below identify the original entries. Native reasoning and tool state are not transferred.\n`
    : "Native reasoning and tool state are not transferred.\n";
  const referenceFits = handoffTokenEstimate(readback) <= budgetTokens;
  let text = referenceFits ? readback : "";
  const recap = options.brief ? clip(`Recap:\n${options.brief}\n`, 6000) : "";
  // Prefer dropping history, then the recap, then the reference. Never truncate
  // the archive path or stop a send because optional context cannot fit.
  if (referenceFits && handoffTokenEstimate(text + recap) <= limit) text += recap;
  const chosen: HandoffHistoryMessage[] = [];
  let charged = handoffTokenEstimate(text);
  // Original user intent first, then recent complete messages. Oversized entries remain readable.
  const firstUser = history.messages.find((message) => message.role === "user");
  const prioritized = [
    ...(firstUser ? [firstUser] : []),
    ...history.messages
      .slice()
      .reverse()
      .filter((message) => message !== firstUser),
  ];
  for (const message of prioritized) {
    if (!referenceFits) break;
    const formatted = `\n[${message.id}] ${message.role}:\n${message.text}\n`;
    const charge = handoffTokenEstimate(formatted);
    if (charged + charge <= budgetTokens) {
      chosen.push(message);
      charged += charge;
    }
  }
  const order = new Map(history.messages.map((message, index) => [message.id, index]));
  chosen.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
  text += chosen.map((entry) => `\n[${entry.id}] ${entry.role}:\n${entry.text}\n`).join("");
  const selectedIds = chosen.map((entry) => entry.id);
  const selected = new Set(selectedIds);
  return {
    text,
    selectedIds,
    omittedIds: history.messages
      .filter((entry) => !selected.has(entry.id))
      .map((entry) => entry.id),
    estimatedTokens: handoffTokenEstimate(text),
    budgetTokens,
    history,
    ...(!referenceFits
      ? {
          notice: options.historyPath
            ? `Earlier conversation was not transferred because the target context budget is full. Saved history: ${options.historyPath}`
            : "Earlier conversation was not transferred because the target context budget is full. It remains in this session's saved history.",
        }
      : {}),
  };
}
