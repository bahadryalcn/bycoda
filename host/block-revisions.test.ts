import { describe, expect, it } from "vitest";
import { blockRevisions } from "./block-revisions";
import { HostStore } from "./store";
import { applyHarnessEvent } from "../src/integrations/harness/core/apply";
import { changedBlocks, registerBlockChanges } from "../src/features/sessions/model/blockChanges";
import { registerStreamingTextUpdate } from "../src/features/sessions/model/stableBlocks";
import type { Block, Session } from "../src/features/sessions/model/session";
import type { HostSession } from "../src/features/connections/model/protocol";

function value(blocks: Block[], revision = 1): HostSession {
  return {
    environmentId: "environment",
    projectId: "project",
    status: "running",
    revision,
    updatedAt: revision,
    session: {
      id: "session",
      cwd: "/project",
      harness: "codex",
      model: "model",
      runtimeMode: "supervised",
      title: "test",
      blocks,
    } as Session,
  };
}

describe("sparse block revisions", () => {
  it("does not inspect historical blocks for a trusted text update and keeps prior revisions immutable", () => {
    let historyReads = 0;
    const history = Array.from({ length: 10000 }, (_, index) => ({
      get id() {
        historyReads++;
        return `history-${index}`;
      },
      role: "assistant" as const,
      text: "history",
    }));
    const tail: Block = { id: "tail", role: "assistant", text: "first", streaming: true };
    const blocks = [...history, tail];
    const previous = {
      ...value(blocks),
      blockRevisions: Object.fromEntries(blocks.map((block) => [block.id, 1])),
    };
    const next = [...history, { ...tail, text: "second" }];
    registerStreamingTextUpdate(blocks, next, blocks.length - 1);
    historyReads = 0;
    const updated = blockRevisions(previous, value(next, 2));
    expect(historyReads).toBe(0);
    expect(updated.tail).toBe(2);
    expect(updated["history-9999"]).toBe(1);
    expect(previous.blockRevisions.tail).toBe(1);
    const serialized = JSON.parse(JSON.stringify(updated));
    expect(serialized.tail).toBe(2);
    expect(Object.keys(serialized)).toHaveLength(10001);
    expect({ ...updated }).toEqual(serialized);
  });

  it("reconciles insertions and deletions without changing an earlier snapshot", () => {
    const a: Block = { id: "a", role: "user", text: "a" };
    const b: Block = { id: "b", role: "assistant", text: "b" };
    const initial = value([a, b]);
    initial.blockRevisions = blockRevisions(undefined, initial);
    const c: Block = { id: "c", role: "tool", text: "new" };
    const next = value([b, c], 2);
    registerBlockChanges(initial.session.blocks, next.session.blocks, [c], ["a"]);
    next.blockRevisions = blockRevisions(initial, next);
    expect(JSON.parse(JSON.stringify(next.blockRevisions))).toEqual({ b: 1, c: 2 });
    expect(next.blockRevisions.a).toBeUndefined();
    expect("a" in next.blockRevisions).toBe(false);
    expect(initial.blockRevisions).toEqual({ a: 1, b: 1 });
    const reordered = value([c, b], 3);
    registerBlockChanges(next.session.blocks, reordered.session.blocks, []);
    expect(blockRevisions(next, reordered)).toBe(next.blockRevisions);
  });

  it("retains structural equality for imported snapshots and supports unusual IDs", () => {
    const previous = value([
      { id: "__proto__", role: "assistant", text: "same" },
      { id: "toString", role: "user", text: "old" },
    ]);
    previous.blockRevisions = blockRevisions(undefined, previous);
    const restored = JSON.parse(JSON.stringify(previous)) as HostSession;
    restored.revision = 2;
    restored.session.blocks[1] = { ...restored.session.blocks[1], text: "new" };
    const revisions = blockRevisions(previous, restored);
    expect(revisions["__proto__"]).toBe(1);
    expect(revisions.toString).toBe(2);
    const remaining = [restored.session.blocks[0]];
    registerBlockChanges(restored.session.blocks, remaining, [], ["toString"]);
    const removed = blockRevisions({ ...restored, blockRevisions: revisions }, value(remaining, 3));
    expect(removed["__proto__"]).toBe(1);
    expect(removed.toString).toBeUndefined();
  });

  it("producer changes include a sealed reply, new tool and later tool update", () => {
    const original = value([{ id: "reply", role: "assistant", text: "reply", streaming: true }]);
    original.blockRevisions = blockRevisions(undefined, original);
    const withTool = applyHarnessEvent(original.session, {
      type: "tool.started",
      callId: "call",
      title: "Read",
      kind: "read",
    });
    const created = changedBlocks(original.session.blocks, withTool.blocks)!;
    expect([...created.keys()]).toEqual(["reply", withTool.blocks[1].id]);
    const middle = { ...original, session: withTool, revision: 2 };
    middle.blockRevisions = blockRevisions(original, middle, created);
    const updated = applyHarnessEvent(withTool, {
      type: "tool.updated",
      callId: "call",
      status: "completed",
      detail: "result",
    });
    const changes = changedBlocks(withTool.blocks, updated.blocks)!;
    expect([...changes.keys()]).toEqual([withTool.blocks[1].id]);
    const revisions = blockRevisions(middle, { ...middle, session: updated, revision: 3 }, changes);
    expect(revisions.reply).toBe(2);
    expect(revisions[withTool.blocks[1].id]).toBe(3);
    expect(middle.blockRevisions[withTool.blocks[1].id]).toBe(2);
  });

  it("persists sparse snapshots, returns deltas and preserves restart-compatible full JSON", () => {
    const store = new HostStore(":memory:");
    try {
      const project = store.addProject("/project", "test");
      const initial = store.save(
        {
          ...value([
            { id: "a", role: "user", text: "prompt" },
            { id: "b", role: "assistant", text: "first", streaming: true },
          ]),
          projectId: project.id,
        },
        {},
      );
      const nextBlocks = [
        initial.session.blocks[0],
        { ...initial.session.blocks[1], text: "second" },
      ];
      registerStreamingTextUpdate(initial.session.blocks, nextBlocks, 1);
      const next = store.save(
        { ...initial, session: { ...initial.session, blocks: nextBlocks }, revision: 2 },
        {},
        { deferred: true },
      );
      expect(next.blockRevisions).toEqual({ a: 1, b: 2 });
      const delta = store.sync(initial.session.id, 1);
      expect(delta.kind).toBe("delta");
      if (delta.kind === "delta") expect(delta.blocks.map((block) => block.id)).toEqual(["b"]);
      store.flushAll();
      const persisted = JSON.parse(
        String(
          store.db.prepare("SELECT snapshot FROM sessions WHERE id=?").get(initial.session.id)!
            .snapshot,
        ),
      );
      expect(persisted.blockRevisions).toEqual({ a: 1, b: 2 });
      expect(persisted.session.blocks[1].text).toBe("second");
    } finally {
      store.close();
    }
  });
});
