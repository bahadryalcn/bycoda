// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import {
  CREW_MEMBER_KEY,
  DELEGATION_PARENT_KEY,
} from "../../../shared/model/host-contracts/delegation";
import { delegatedBlockId } from "./delegatedBlockId";
import {
  createCardPlacer,
  crewMemberChildren,
  delegatedCardBlock,
  placeDelegatedCards,
} from "./delegatedCards";
import { registerStreamingTextUpdate, streamingTextUpdate } from "./stableBlocks";
import { newSession, type Block, type Session } from "./session";
import { groupTurnItems } from "./transcriptActivity";

const PARENT = "parent-1";

function member(id: string, patch: Partial<Session> = {}, taskId?: string, askedAt = 2_000) {
  return {
    ...newSession("codex", "/repo", "codex:gpt-a"),
    id,
    title: "Review the parser",
    modelSettings: {
      [DELEGATION_PARENT_KEY]: JSON.stringify({
        parentSessionId: PARENT,
        runId: "ask_1",
        kind: "subagent",
        model: "codex:gpt-a",
        startedAt: askedAt,
      }),
      [CREW_MEMBER_KEY]: JSON.stringify({
        id: "m1",
        name: "Reviewer",
        handle: "reviewer",
        ...(taskId ? { taskId } : {}),
      }),
    },
    ...patch,
  } satisfies Session;
}

const user = (id: string, text: string, startedAt: number): Block => ({
  id,
  role: "user",
  text,
  startedAt,
});
const reply = (id: string): Block => ({ id, role: "assistant", text: "Done." });

describe("placeDelegatedCards", () => {
  const blocks = [
    user("u1", "first", 1_000),
    reply("a1"),
    user(
      "u2",
      "@reviewer look\n\nDelegated to @reviewer (task member-ask-9); results will appear here.",
      3_000,
    ),
    reply("a2"),
  ];

  it("places the card after the message whose note names the task", () => {
    const placed = placeDelegatedCards(blocks, [member("c1", {}, "member-ask-9", 9_999)]);
    expect(placed.map((block) => block.id)).toEqual([
      "u1",
      "a1",
      "u2",
      delegatedBlockId("c1"),
      "a2",
    ]);
  });

  it("falls back to the last message sent at or before the ask", () => {
    const placed = placeDelegatedCards(blocks, [member("c1", {}, undefined, 3_500)]);
    expect(placed.map((block) => block.id)).toContain(delegatedBlockId("c1"));
    expect(placed.findIndex((block) => block.id === delegatedBlockId("c1"))).toBe(3);
    const early = placeDelegatedCards(blocks, [member("c2", {}, undefined, 500)]);
    expect(early.findIndex((block) => block.id === delegatedBlockId("c2"))).toBe(1);
  });

  it("leaves a child whose turn is unknown out, and keeps order for one turn", () => {
    const later = [user("u", "late", 10_000)];
    expect(placeDelegatedCards(later, [member("c1", {}, undefined, 10)])).toBe(later);
    const two = placeDelegatedCards(blocks, [
      member("c1", {}, "member-ask-9"),
      member("c2", {}, "member-ask-9"),
    ]);
    expect(two.slice(3, 5).map((block) => block.id)).toEqual([
      delegatedBlockId("c1"),
      delegatedBlockId("c2"),
    ]);
  });

  it("keeps the card as its own row in a settled turn", () => {
    const placed = placeDelegatedCards(blocks, [member("c1", {}, "member-ask-9")]);
    const turn = placed.slice(2);
    const items = groupTurnItems(turn, { settled: true });
    expect(items.map((item) => item.type)).toEqual(["block", "subagents", "block"]);
  });
});

describe("delegatedCardBlock", () => {
  it("names the member and carries status and the final message as the report", () => {
    const done = member("c1", {
      busy: false,
      blocks: [user("cu", "Review it", 2_100), reply("m1")],
    });
    const block = delegatedCardBlock(done);
    expect(block.agentRun?.name).toBe("Reviewer");
    expect(block.agentRun?.agentType).toBe("@reviewer");
    expect(block.tool?.status).toBe("completed");
    expect(block.tool?.detail).toBe("Done.");
    expect(block.agentRun?.steps).toHaveLength(0);
    const running = delegatedCardBlock(member("c2", { busy: true }));
    expect(running.tool?.status).toBe("running");
    expect(running.tool?.detail).toBeUndefined();
  });

  it("selects only Crew member children", () => {
    const plain = { ...member("p"), modelSettings: {} };
    expect(crewMemberChildren([plain, member("c1")]).map((child) => child.id)).toEqual(["c1"]);
  });
});

describe("createCardPlacer", () => {
  const base: Block[] = [
    user("u1", "first", 1_000),
    reply("a1"),
    user("u2", "go\n\nDelegated to @reviewer (task member-ask-9)", 3_000),
    { id: "a2", role: "assistant", text: "He", streaming: true },
  ];
  const child = member("c1", { busy: true }, "member-ask-9");
  const textFrame = (previous: Block[], text: string): Block[] => {
    const next = previous.slice();
    next[next.length - 1] = { ...next[next.length - 1], text };
    registerStreamingTextUpdate(previous, next, next.length - 1);
    return next;
  };

  it("matches placeDelegatedCards for no children, added, removed and moved cards", () => {
    const place = createCardPlacer();
    const none: Session[] = [];
    expect(place(base, none)).toEqual(placeDelegatedCards(base, none));
    expect(place(base, [child])).toEqual(placeDelegatedCards(base, [child]));
    const moved = member("c1", { busy: true }, "member-ask-1");
    expect(place(base, [moved])).toEqual(placeDelegatedCards(base, [moved]));
    expect(place(base, none)).toEqual(placeDelegatedCards(base, none));
    const structural = [...base, user("u3", "next", 5_000)];
    expect(place(structural, [child])).toEqual(placeDelegatedCards(structural, [child]));
  });

  it("keeps card and block identity and the text-only registration on a text frame", () => {
    const place = createCardPlacer();
    const children = [child];
    const first = place(base, children);
    const frame = textFrame(base, "Hel");
    const second = place(frame, children);
    expect(second).toEqual(placeDelegatedCards(frame, children));
    expect(second.find((block) => block.id === delegatedBlockId("c1"))).toBe(
      first.find((block) => block.id === delegatedBlockId("c1")),
    );
    expect(second[0]).toBe(first[0]);
    expect(streamingTextUpdate(first, second)).toBe(second.length - 1);
    const third = place(textFrame(frame, "Hello"), children);
    expect(third.at(-1)?.text).toBe("Hello");
    expect(third.find((block) => block.id === delegatedBlockId("c1"))).toBe(
      first.find((block) => block.id === delegatedBlockId("c1")),
    );
  });

  it("returns the input itself when no card is placed", () => {
    const place = createCardPlacer();
    const none: Session[] = [];
    place(base, none);
    const frame = textFrame(base, "Hel");
    expect(place(frame, none)).toBe(frame);
  });

  it("rebuilds the card when the child's data changes", () => {
    const place = createCardPlacer();
    const first = place(base, [child]);
    const updated = { ...child, busy: false };
    const frame = textFrame(base, "Hel");
    const second = place(frame, [updated]);
    expect(second).toEqual(placeDelegatedCards(frame, [updated]));
    const id = delegatedBlockId("c1");
    expect(second.find((block) => block.id === id)).not.toBe(
      first.find((block) => block.id === id),
    );
  });

  it("re-places when the changed block is a user message", () => {
    const place = createCardPlacer();
    place(base, [child]);
    const edited = base.slice();
    edited[2] = { ...edited[2], text: "go again" };
    registerStreamingTextUpdate(base, edited, 2);
    expect(place(edited, [child])).toEqual(placeDelegatedCards(edited, [child]));
  });
});
