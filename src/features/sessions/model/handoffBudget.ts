import type { Session } from "./session";

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
};

/** Charge one token per UTF-8 byte: conservative for code, Unicode and unknown tokenizers. */
export function handoffTokenEstimate(text: string): number {
  return new TextEncoder().encode(text).length;
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
      : 16_000;
  const reserve = Math.max(512, options.reservedTokens ?? Math.floor(window * 0.4));
  const budgetTokens = Math.max(
    0,
    Math.min(24_000, window - reserve - handoffTokenEstimate(options.request ?? "")),
  );
  const limit = budgetTokens;
  const clip = (value: string, bytes: number): string => {
    let result = "";
    let used = 0;
    for (const char of value) {
      const size = new TextEncoder().encode(char).length;
      if (used + size > bytes) break;
      result += char;
      used += size;
    }
    return result;
  };
  const readback = options.historyPath
    ? `Earlier conversation is saved on this host at ${JSON.stringify(options.historyPath)}. Read that JSON file when omitted decisions are needed; message ids below identify the original entries. Native reasoning and tool state are not transferred.\n`
    : "Native reasoning and tool state are not transferred.\n";
  if (handoffTokenEstimate(readback) > budgetTokens)
    throw new Error(
      "Target context capacity cannot fit the current request, response reserve and handoff readback reference",
    );
  let text = readback;
  if (options.brief)
    text += clip(
      `Recap:\n${options.brief}\n`,
      Math.min(limit - handoffTokenEstimate(text), Math.floor(limit * 0.25)),
    );
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
  };
}
