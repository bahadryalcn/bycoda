import type { Block } from "../../src/features/sessions/model/session";

/**
 * The whole reply of the last turn: assistant (and optionally plan) text after the
 * last user message. A reply may span several messages, or sit in a plan block
 * when the turn ran in plan mode.
 */
export function lastTurnReply(
  blocks: readonly Pick<Block, "role" | "text">[],
  options: { includePlan?: boolean } = {},
): string {
  const lastUser = blocks.findLastIndex((block) => block.role === "user");
  return blocks
    .slice(lastUser + 1)
    .filter(
      (block) =>
        (block.role === "assistant" || (options.includePlan && block.role === "plan")) &&
        block.text.trim(),
    )
    .map((block) => block.text)
    .join("\n\n");
}
