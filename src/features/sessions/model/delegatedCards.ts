import {
  crewMemberOf,
  delegatedAgentBlock,
  delegatedFailureText,
  delegatedStatus,
  delegationParentOf,
} from "./delegatedAgents";
import { delegationToolKind } from "./bycodaToolCall";
import { delegatedChildIdOf } from "./delegatedBlockId";
import { failedAskCard } from "./delegatedFailedCalls";
import { hostSessionBinding } from "../../connections/public/sessionExecutionBinding";
import type { Block, Session } from "./session";
import { registerStreamingBlockUpdate, streamingBlockUpdate } from "./stableBlocks";

/**
 * Delegated runs as inline transcript cards. Each child session becomes one
 * subagent-shaped block, so the transcript renders it with the same row as a native
 * subagent. It stands in for the `agents.delegate` call that started it when that call
 * names the child, else it follows the user message that asked for it.
 */

/** Slack for a user message stamped marginally after the Host recorded its ask. */
const ASK_SKEW_MS = 2_000;

type DelegateCall = {
  kind: "delegate" | "wait" | "reply";
  sessionIds: string[];
};

const delegateCalls = new WeakMap<Block, DelegateCall | null>();
const failedCards = new WeakMap<Block, Block | null>();

/**
 * The child sessions a Host delegate, wait or reply call names; undefined for any other block.
 * A block is a snapshot, so its parse is kept: a later projection of the same block, and
 * every block a frame did not touch, reads it instead of parsing the result again.
 */
function delegateCall(block: Block): DelegateCall | undefined {
  if (block.role !== "tool") return undefined;
  let call = delegateCalls.get(block);
  if (call === undefined) {
    call = parseDelegateCall(block) ?? null;
    delegateCalls.set(block, call);
  }
  return call ?? undefined;
}

/** `failedAskCard`, one card object per block so a failed call keeps its identity. */
function failedCardOf(block: Block): Block | undefined {
  if (block.role !== "tool") return undefined;
  let card = failedCards.get(block);
  if (card === undefined) {
    card = failedAskCard(block) ?? null;
    failedCards.set(block, card);
  }
  return card ?? undefined;
}

function parseDelegateCall(block: Block): DelegateCall | undefined {
  // A path-shaped argument (a model ref like `grok:grok-4.6`) can turn the title into
  // "Read …"; the preview keeps the tool's own name.
  const found = delegationToolKind(block);
  if (!found) return undefined;
  // An advisor consult starts a child the same way a delegate does, so its card takes the call's place.
  const kind = found === "consult" ? "delegate" : found;
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
  const report =
    status === "done" && last?.kind === "message"
      ? last.text.trim()
      : status === "failed"
        ? (delegatedFailureText(child) ?? "")
        : "";
  return {
    ...block,
    tool: {
      ...block.tool,
      status: status === "done" ? "completed" : status === "running" ? "running" : status,
      ...(report ? { detail: report } : {}),
    },
    agentRun: block.agentRun && {
      ...block.agentRun,
      steps: report && status === "done" ? steps.slice(0, -1) : steps,
    },
  };
}

/** The user message that started this ask: its note names the task, else by when it was sent. */
function askingTurn(blocks: readonly Block[], users: readonly number[], child: Session): number {
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
 * call that names its child, and `agents.wait`/`agents.reply` calls whose runs all have cards
 * are dropped: the card and its sheet show those messages and results.
 * Other children get their card after the user message that asked for them; a child whose
 * turn cannot be found is left out, and the dock still lists it.
 */
export function placeDelegatedCards(blocks: Block[], children: readonly Session[]): Block[] {
  return placeFromPlan(blocks, planFor(blocks, children));
}

function placeFromPlan(blocks: Block[], { inPlace, hidden, after }: CardPlan): Block[] {
  if (!after.size && !inPlace.size && !hidden.size) return blocks;
  return blocks.flatMap((block, index) =>
    hidden.has(index) ? [] : [inPlace.get(index) ?? block, ...(after.get(index) ?? [])],
  );
}

/** The children `placeDelegatedCards` gives an inline card; the dock need not list them again. */
export function cardedChildren(blocks: Block[], children: readonly Session[]): Set<string> {
  if (!children.length) return new Set();
  // A copy: the plan's own set is shared by every reader of this projection.
  return new Set(planFor(blocks, children).carded);
}

/** Where every card of one projection goes: `blocks` and `children` read once. */
type CardPlan = {
  placed: Set<Session>;
  /** Blocks swapped for a card, by index. */
  inPlace: Map<number, Block>;
  /** Wait and reply calls whose runs all have a card, by index. */
  hidden: Set<number>;
  /** Cards that follow the user message at that index, in child order. */
  after: Map<number, Block[]>;
  /** Ids of the children that get an inline card. */
  carded: Set<string>;
};

const plans = new WeakMap<readonly Block[], WeakMap<readonly Session[], CardPlan>>();

/**
 * The plan for one projection, built once. The transcript's card placement and the dock's
 * list of carded children read the same `blocks` and `children`, so the second reader
 * takes the first one's plan rather than walking every block and ask again.
 */
function planFor(blocks: Block[], children: readonly Session[]): CardPlan {
  let byChildren = plans.get(blocks);
  if (!byChildren) {
    byChildren = new WeakMap();
    plans.set(blocks, byChildren);
  }
  let plan = byChildren.get(children);
  if (!plan) {
    plan = planCards(blocks, children);
    byChildren.set(children, plan);
  }
  return plan;
}

function planCards(blocks: Block[], children: readonly Session[]): CardPlan {
  const byId = childIndex(children);
  const placed = new Set<Session>();
  const inPlace = new Map<number, Block>();
  const hidden = new Set<number>();
  const users: number[] = [];
  blocks.forEach((block, index) => {
    if (block.role === "user" && !block.internal) users.push(index);
    // A call that failed before any child existed becomes a failed card of its own.
    const failed = failedCardOf(block);
    if (failed) inPlace.set(index, failed);
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
  const carded = new Set<string>();
  for (const child of placed) carded.add(child.id);
  for (const child of children) {
    if (placed.has(child)) continue;
    const turn = askingTurn(blocks, users, child);
    if (turn < 0) continue;
    const card = delegatedCardBlock(child);
    // Children arrive oldest ask first; pushing keeps that order within a turn.
    const row = after.get(turn);
    if (row) row.push(card);
    else after.set(turn, [card]);
    const id = delegatedChildIdOf(card.id);
    if (id) carded.add(id);
  }
  return { placed, inPlace, hidden, after, carded };
}

/**
 * Reuse the plan when the frame keeps every call and ask. Changing a tool's
 * label can name another child; output-only frames exclude delegation calls.
 */
function carryPlan(
  previous: Block[],
  next: Block[],
  children: readonly Session[],
  changed: Block,
  outputOnly: boolean,
): void {
  if (changed.role === "tool" && !outputOnly) return;
  const plan = plans.get(previous)?.get(children);
  if (!plan) return;
  let byChildren = plans.get(next);
  if (!byChildren) {
    byChildren = new WeakMap();
    plans.set(next, byChildren);
  }
  byChildren.set(children, plan);
}

/**
 * `placeDelegatedCards` for a stream of frames. When the children are unchanged and
 * `blocks` differs only by streamed prose or tool output, the previous result
 * is copied with that block swapped and the same kind of incremental
 * update is registered on it, so the transcript keeps its fast path and every card
 * and older block keeps its identity.
 */
export function createCardPlacer(): (blocks: Block[], children: readonly Session[]) => Block[] {
  let last: { blocks: Block[]; children: readonly Session[]; output: Block[] } | undefined;
  return (blocks, children) => {
    if (last && last.children === children) {
      const update = streamingBlockUpdate(last.blocks, blocks);
      const from = update && last.blocks[update.index];
      const to = update && blocks[update.index];
      // A user block's text can change which turn a card belongs to, so it re-places.
      if (update && from && to && from.role !== "user" && to.role !== "user") {
        if (last.output === last.blocks) {
          carryPlan(last.blocks, blocks, children, to, update.kind === "tool-output");
          last = { blocks, children, output: blocks };
          return blocks;
        }
        const at = last.output.lastIndexOf(from);
        if (at >= 0) {
          const output = last.output.slice();
          output[at] = to;
          registerStreamingBlockUpdate(last.output, output, at, update.kind);
          carryPlan(last.blocks, blocks, children, to, update.kind === "tool-output");
          last = { blocks, children, output };
          return output;
        }
      }
    }
    // The plan is kept for this projection: the dock reads the same one.
    const output = placeFromPlan(blocks, planFor(blocks, children));
    last = { blocks, children, output };
    return output;
  };
}
