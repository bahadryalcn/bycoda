import {
  crewMemberOf,
  delegatedAgentBlock,
  delegatedStatus,
  delegationParentOf,
} from "./delegatedAgents";
import type { Block, Session } from "./session";
import { registerStreamingTextUpdate, streamingTextUpdate } from "./stableBlocks";

/**
 * Crew member asks as inline transcript cards. Each child session becomes one
 * subagent-shaped block, placed right after the user message that delegated to it, so the
 * transcript renders it with the same row as a native subagent.
 */

/** Slack for a user message stamped marginally after the Host recorded its ask. */
const ASK_SKEW_MS = 2_000;

/** Children that run a Crew member; other delegated children stay in the dock and sheet. */
export function crewMemberChildren(children: readonly Session[]): Session[] {
  return children.filter((child) => !!crewMemberOf(child));
}

const cardBlocks = new WeakMap<Session, Block>();

/** The member's run as a card block: its steps, and its last message as the report.
 * One block per session object, so an unchanged child keeps its card's identity. */
export function delegatedCardBlock(child: Session): Block {
  let card = cardBlocks.get(child);
  if (!card) {
    card = buildCardBlock(child);
    cardBlocks.set(child, card);
  }
  return card;
}

function buildCardBlock(child: Session): Block {
  const block = delegatedAgentBlock(child);
  const status = delegatedStatus(child);
  const steps = block.agentRun?.steps ?? [];
  const last = steps[steps.length - 1];
  const report = status === "done" && last?.kind === "message" ? last.text.trim() : "";
  return {
    ...block,
    tool: {
      ...block.tool,
      status: status === "done" ? "completed" : status === "running" ? "running" : status,
      ...(report ? { detail: report } : {}),
    },
    agentRun: block.agentRun && {
      ...block.agentRun,
      steps: report ? steps.slice(0, -1) : steps,
    },
  };
}

/** The user message that started this ask: its note names the task, else by when it was sent. */
function askingTurn(blocks: readonly Block[], child: Session): number {
  const users = blocks.flatMap((block, index) =>
    block.role === "user" && !block.internal ? [index] : [],
  );
  const taskId = crewMemberOf(child)?.taskId;
  const noted = taskId ? users.find((index) => blocks[index].text.includes(`task ${taskId}`)) : -1;
  if (noted !== undefined && noted >= 0) return noted;
  const askedAt = delegationParentOf(child)?.startedAt;
  if (askedAt === undefined) return -1;
  return users.reduce((found, index) => {
    const sentAt = blocks[index].startedAt;
    return sentAt !== undefined && sentAt <= askedAt + ASK_SKEW_MS ? index : found;
  }, -1);
}

/**
 * `blocks` with one card per member child after the user message that asked for it, oldest
 * ask first. A child whose turn cannot be found is left out; the dock still lists it.
 */
export function placeDelegatedCards(blocks: Block[], children: readonly Session[]): Block[] {
  if (!children.length) return blocks;
  const after = new Map<number, Block[]>();
  for (const child of children) {
    const turn = askingTurn(blocks, child);
    if (turn < 0) continue;
    after.set(turn, [...(after.get(turn) ?? []), delegatedCardBlock(child)]);
  }
  if (!after.size) return blocks;
  return blocks.flatMap((block, index) => [block, ...(after.get(index) ?? [])]);
}

/**
 * `placeDelegatedCards` for a stream of frames. When the children are unchanged and
 * `blocks` differs from the previous input only by the streamed text of a non-user
 * block, the previous result is copied with that block swapped and the text-only
 * update is registered on it, so the transcript keeps its fast path and every card
 * and older block keeps its identity.
 */
export function createCardPlacer(): (blocks: Block[], children: readonly Session[]) => Block[] {
  let last: { blocks: Block[]; children: readonly Session[]; output: Block[] } | undefined;
  return (blocks, children) => {
    if (last && last.children === children) {
      const index = streamingTextUpdate(last.blocks, blocks);
      const from = index === undefined ? undefined : last.blocks[index];
      const to = index === undefined ? undefined : blocks[index];
      // A user block's text can change which turn a card belongs to, so it re-places.
      if (from && to && from.role !== "user" && to.role !== "user") {
        if (last.output === last.blocks) {
          last = { blocks, children, output: blocks };
          return blocks;
        }
        const at = last.output.lastIndexOf(from);
        if (at >= 0) {
          const output = last.output.slice();
          output[at] = to;
          registerStreamingTextUpdate(last.output, output, at);
          last = { blocks, children, output };
          return output;
        }
      }
    }
    const output = placeDelegatedCards(blocks, children);
    last = { blocks, children, output };
    return output;
  };
}
