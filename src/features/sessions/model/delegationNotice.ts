import type { Block, SessionMessageAuthor } from "./session";

/** One child's part of a Host delegation notice (see host/delegation/communication.ts). */
export type DelegationNoticeSection = {
  runId: string;
  title: string;
  reason: "completion" | "message";
  /** Completion only: succeeded, failed or cancelled. */
  status?: string;
  /** The child's text without the Host's one-line header. */
  body: string;
};

type DelegationAuthor = Extract<SessionMessageAuthor, { kind: "delegation" }>;

/** The Host joins the sections of a batched notice with this separator. */
const SECTION_SEPARATOR = "\n\n---\n\n";
const COMPLETION = /^(?:Subagent|Advisor) completion: (.+) \(([^()\s]+)\), status (\w+)\./;
const MESSAGE = /^Collaboration message from (.+) \(([^()\s]+)\)\./;

/** Splits a delegation-authored text into one section per child; an unreadable section keeps the author's identity. */
export function delegationNoticeSections(
  text: string,
  author: DelegationAuthor,
): DelegationNoticeSection[] {
  return text.split(SECTION_SEPARATOR).map((part, index) => {
    const completion = COMPLETION.exec(part);
    const message = completion ? null : MESSAGE.exec(part);
    const hit = completion ?? message;
    const split = part.indexOf("\n\n");
    const body = (hit && split >= 0 ? part.slice(split + 2) : part).trim();
    if (hit) {
      return {
        runId: hit[2],
        title: hit[1],
        reason: completion ? "completion" : "message",
        ...(completion ? { status: hit[3] } : {}),
        body,
      } satisfies DelegationNoticeSection;
    }
    return {
      runId: index === 0 ? author.runId : "",
      title: index === 0 ? author.title : "",
      reason: author.reason,
      body,
    };
  });
}

/** Whether the parent already received a notice for this child run, by its latest completion. */
export function delegationResultFor(
  blocks: readonly Block[],
  runId: string,
): DelegationNoticeSection | undefined {
  for (let i = blocks.length - 1; i >= 0; i--) {
    const block = blocks[i];
    if (block.role !== "user" || block.author?.kind !== "delegation") continue;
    const found = delegationNoticeSections(block.text, block.author).find(
      (section) => section.runId === runId && section.reason === "completion",
    );
    if (found) return found;
  }
  return undefined;
}
