import {
  crewMemberOf,
  delegatedAgentBlock,
  delegatedStatus,
  delegationParentOf,
} from "./delegatedAgents";
import { hostSessionBinding } from "../../connections/public/sessionExecutionBinding";
import type { Block, Session } from "./session";
import { registerStreamingTextUpdate, streamingTextUpdate } from "./stableBlocks";

/**
 * Delegated runs as inline transcript cards. Each child session becomes one
 * subagent-shaped block, so the transcript renders it with the same row as a native
 * subagent. It stands in for the `agents.delegate` call that started it when that call
 * names the child, else it follows the user message that asked for it.
 */

/** Slack for a user message stamped marginally after the Host recorded its ask. */
const ASK_SKEW_MS = 2_000;

type DelegateCall = { kind: "delegate" | "wait"; sessionIds: string[] };

/** `agents.delegate` / `agents.wait` however the provider names the Host tool. */
const DELEGATE_TOOL = /(?:^|[:_.])agents[_.](delegate|wait)$/i;

/** The child sessions a Host delegate or wait call names; undefined for any other block. */
function delegateCall(block: Block): DelegateCall | undefined {
  if (block.role !== "tool") return undefined;
  const kind = DELEGATE_TOOL.exec((block.tool?.title || block.text).trim())?.[1]?.toLowerCase();
  if (kind !== "delegate" && kind !== "wait") return undefined;
  const sessionIds: string[] = [];
  try {
    const detail: unknown = JSON.parse(block.tool?.detail ?? "");
    const runs = (detail as { runs?: unknown } | null)?.runs;
    for (const run of Array.isArray(runs) ? runs : [detail]) {
      const id = (run as { sessionId?: unknown } | null)?.sessionId;
      if (typeof id === "string" && id) sessionIds.push(id);
    }
  } catch {
    // A call without a readable result names no child; it stays a plain row.
  }
  return { kind, sessionIds };
}

/** A child by the session id the Host reports: its own, or the Host's id for it. */
function childIndex(children: readonly Session[]): Map<string, Session> {
  const index = new Map<string, Session>();
  for (const child of children) {
    index.set(child.id, child);
    try {
      const hostId = hostSessionBinding(child)?.sessionId;
      if (hostId) index.set(hostId, child);
    } catch {
      // No readable binding: the local id still matches.
    }
  }
  return index;
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
 * `blocks` with one card per child, oldest ask first. A card replaces the `agents.delegate`
 * call that names its child, and `agents.wait` calls whose runs all have cards are dropped.
 * Other children get their card after the user message that asked for them; a child whose
 * turn cannot be found is left out, and the dock still lists it.
 */
export function placeDelegatedCards(blocks: Block[], children: readonly Session[]): Block[] {
  if (!children.length) return blocks;
  const byId = childIndex(children);
  const placed = new Set<Session>();
  const inPlace = new Map<number, Block>();
  const hidden = new Set<number>();
  blocks.forEach((block, index) => {
    const call = delegateCall(block);
    if (!call) return;
    if (call.kind === "delegate") {
      const child = byId.get(call.sessionIds[0] ?? "");
      if (child && !placed.has(child)) {
        placed.add(child);
        inPlace.set(index, delegatedCardBlock(child));
      }
    } else if (call.sessionIds.length && call.sessionIds.every((id) => byId.has(id))) {
      hidden.add(index);
    }
  });
  const after = new Map<number, Block[]>();
  for (const child of children) {
    if (placed.has(child)) continue;
    const turn = askingTurn(blocks, child);
    if (turn < 0) continue;
    after.set(turn, [...(after.get(turn) ?? []), delegatedCardBlock(child)]);
  }
  if (!after.size && !inPlace.size && !hidden.size) return blocks;
  return blocks.flatMap((block, index) =>
    hidden.has(index) ? [] : [inPlace.get(index) ?? block, ...(after.get(index) ?? [])],
  );
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
