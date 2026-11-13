import { describe, expect, it } from "vitest";
import type { DockAgent } from "./activityDock";
import type { Block } from "./session";
import { sessionSubagents } from "./sessionSubagents";

const sub = (id: string, status: string, startedAt?: number): Block => ({
  id,
  role: "tool",
  text: `Agent: ${id}`,
  tool: { callId: id, kind: "agent", status },
  agentRun: { name: id, steps: [], ...(startedAt ? { startedAt } : {}) },
});
const user = (id: string): Block => ({ id, role: "user", text: "go", startedAt: 1 });
const child = (blockId: string, startedAt: number): DockAgent => ({
  blockId,
  sessionId: blockId,
  name: blockId,
  kind: "agent",
  status: "done",
  detail: "",
  startedAt,
});

describe("sessionSubagents", () => {
  it("keeps nested native runs under their child instead of adding parent menu rows", () => {
    const block = sub("child", "in_progress");
    block.agentRun!.steps = [
      {
        id: "nested",
        kind: "tool",
        text: "Review",
        toolKind: "subagent",
        agentRun: { name: "Nested", steps: [] },
      },
    ];
    expect(sessionSubagents([user("u"), block], true).map((row) => row.blockId)).toEqual(["child"]);
  });
  it("is empty without subagents and ignores background commands", () => {
    const command: Block = {
      id: "c",
      role: "tool",
      text: "dev",
      tool: { callId: "c", kind: "execute", status: "in_progress", background: true },
    };
    expect(sessionSubagents([user("u"), command], true)).toEqual([]);
  });

  it("keeps finished subagents of earlier turns, newest first", () => {
    const blocks = [
      user("u1"),
      sub("old", "completed", 10),
      user("u2"),
      sub("new", "completed", 20),
    ];
    expect(sessionSubagents(blocks, false).map((a) => a.blockId)).toEqual(["new", "old"]);
  });

  it("marks only the latest turn running while busy", () => {
    const blocks = [user("u1"), sub("cut", "in_progress"), user("u2"), sub("live", "in_progress")];
    const rows = sessionSubagents(blocks, true);
    expect(rows.find((a) => a.blockId === "live")?.status).toBe("running");
    expect(rows.find((a) => a.blockId === "cut")?.status).toBe("interrupted");
    expect(rows[0].blockId).toBe("live");
  });

  it("merges delegated children and drops duplicates", () => {
    const blocks = [user("u"), sub("n", "completed", 5)];
    const rows = sessionSubagents(blocks, false, [
      child("d1", 30),
      child("d1", 30),
      child("d2", 1),
    ]);
    expect(rows.map((a) => a.blockId)).toEqual(["d1", "n", "d2"]);
  });
});
