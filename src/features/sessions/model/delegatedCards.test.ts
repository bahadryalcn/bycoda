// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import {
  CREW_MEMBER_KEY,
  DELEGATION_PARENT_KEY,
} from "../../../shared/model/host-contracts/delegation";
import { delegatedBlockId } from "./delegatedBlockId";
import { createCardPlacer, delegatedCardBlock, placeDelegatedCards } from "./delegatedCards";
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

describe("placeDelegatedCards for Host agents.delegate calls", () => {
  const plain = (id: string, askedAt = 2_000): Session => {
    const child = member(id, {}, undefined, askedAt);
    return {
      ...child,
      modelSettings: { [DELEGATION_PARENT_KEY]: child.modelSettings![DELEGATION_PARENT_KEY] },
    };
  };
  const call = (id: string, title: string, detail: string): Block => ({
    id,
    role: "tool",
    text: title,
    tool: { kind: "other", title, status: "completed", detail },
  });
  const delegate = (
    id: string,
    sessionId: string,
    title = "bycoda-conversation:conversation_agents_delegate",
  ) => call(id, title, JSON.stringify({ runId: "r", sessionId, status: "running" }));
  const wait = (id: string, ...sessionIds: string[]) =>
    call(
      id,
      "mcp__bycoda_conversation__conversation_agents_wait",
      JSON.stringify({ runs: sessionIds.map((sessionId) => ({ sessionId, status: "done" })) }),
    );
  const ids = (blocks: Block[]) => blocks.map((block) => block.id);

  it("replaces the delegate call with the card and hides its wait call", () => {
    const blocks = [
      user("u1", "audit", 1_000),
      delegate("d1", "c1"),
      delegate("d2", "c2", "conversation_agents_delegate"),
      wait("w1", "c1", "c2"),
      reply("a1"),
    ];
    const placed = placeDelegatedCards(blocks, [plain("c1"), plain("c2")]);
    expect(ids(placed)).toEqual(["u1", delegatedBlockId("c1"), delegatedBlockId("c2"), "a1"]);
  });

  it("hides a reply call to a run that has a card", () => {
    const replyCall = (id: string, sessionId: string) =>
      call(
        id,
        "bycoda-conversation:conversation_agents_reply",
        JSON.stringify({ runId: "r", sessionId, status: "running" }),
      );
    const blocks = [
      user("u1", "audit", 1_000),
      delegate("d1", "c1"),
      replyCall("r1", "c1"),
      replyCall("r2", "x"),
    ];
    const placed = placeDelegatedCards(blocks, [plain("c1")]);
    expect(ids(placed)).toEqual(["u1", delegatedBlockId("c1"), "r2"]);
  });

  it("recognizes a delegate call the preview relabeled as a read", () => {
    const relabeled: Block = {
      ...delegate("d1", "c1"),
      text: "Read grok:grok-4.6",
      tool: {
        ...delegate("d1", "c1").tool!,
        title: "Read grok:grok-4.6",
        preview: {
          kind: "read",
          path: "grok:grok-4.6",
          title: "bycoda-conversation:conversation_agents_delegate",
        },
      },
    };
    const placed = placeDelegatedCards([user("u1", "audit", 1_000), relabeled], [plain("c1")]);
    expect(ids(placed)).toEqual(["u1", delegatedBlockId("c1")]);
  });

  it("keeps a failed delegate call and a wait that names an unknown run", () => {
    const failed = call("d1", "agents.delegate", JSON.stringify({ error: "no model" }));
    const blocks = [
      user("u1", "audit", 1_000),
      failed,
      delegate("d2", "c1"),
      wait("w1", "c1", "x"),
    ];
    const placed = placeDelegatedCards(blocks, [plain("c1")]);
    expect(ids(placed)).toEqual(["u1", "d1", delegatedBlockId("c1"), "w1"]);
  });

  it("falls back to the asking turn when no call names the child", () => {
    const blocks = [user("u1", "audit", 1_000), reply("a1")];
    const placed = placeDelegatedCards(blocks, [plain("c1")]);
    expect(ids(placed)).toEqual(["u1", delegatedBlockId("c1"), "a1"]);
  });

  it("keeps card identity on a text frame around a replaced call", () => {
    const base = [
      user("u1", "audit", 1_000),
      delegate("d1", "c1"),
      { ...reply("a1"), streaming: true },
    ];
    const children = [plain("c1")];
    const place = createCardPlacer();
    const first = place(base, children);
    const next = base.slice();
    next[2] = { ...next[2], text: "Hel" };
    registerStreamingTextUpdate(base, next, 2);
    const second = place(next, children);
    expect(second).toEqual(placeDelegatedCards(next, children));
    expect(second[1]).toBe(first[1]);
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
