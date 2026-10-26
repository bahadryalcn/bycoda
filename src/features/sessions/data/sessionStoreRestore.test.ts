import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionRecord } from "./sessionStore";
import { MAX_TOOL_INSPECTION_CHARS } from "../model/toolInspection";
import { PERSISTED_AGENT_OUTPUT_RUN_CHARS } from "../model/agentOutput";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invoke(...args) }));

const { getSession, sanitizeSessionForPersist } = await import("./sessionStore");
const { newSession } = await import("../model/session");
const { conversationReplayPrompt } = await import("../model/conversationRewind");

/** A saved Codex session holding the one row this PR repairs. */
function codexRecord(): SessionRecord {
  return {
    id: "s1",
    harness: "codex",
    model: "gpt-5",
    cwd: "/repo",
    providerSessionId: "01a0e6f4-13e3-7692-9250-4befceed807b",
    blocks: [
      { id: "b0", role: "user", text: "list the agents" },
      {
        id: "b1",
        role: "tool",
        text: "Shell",
        tool: {
          callId: "exec-1",
          title: "Shell",
          kind: "execute",
          status: "completed",
          preview: {
            kind: "shell",
            title: "rg --files -g AGENTS.md -g '!node_modules'",
          },
        },
      },
    ],
  } as unknown as SessionRecord;
}

describe("restoring a session whose repair cannot be persisted", () => {
  beforeEach(() => invoke.mockReset());

  it("recovers a stored Codex/Gemini mixed identity without losing the chat or its selected model", async () => {
    const record = {
      ...codexRecord(),
      title: "Earlier conversation",
      model: "antigravity:gemini-3.8-flash-high",
    };
    invoke.mockImplementation(async (command: string) =>
      command === "session_get" ? record : null,
    );
    const restored = await getSession(record.id);
    expect(restored).toMatchObject({ id: record.id, harness: "antigravity", model: record.model });
    expect(restored?.providerSessionId).toBeUndefined();
    expect(restored?.blocks[0]).toEqual(record.blocks[0]);
    expect(restored?.pendingSwitch?.from).toBe("codex");
    expect(restored?.pendingSwitch?.fromProviderSessionId).toBe(record.providerSessionId);
  });

  it("reopens an unsent provider switch in the same conversation with durable context", async () => {
    const session = newSession("claude", "/repo");
    session.blocks = [
      { id: "u1", role: "user", text: "Preserve the parser contract" },
      { id: "a1", role: "assistant", text: "Parser callers verified" },
    ];
    session.pendingSwitch = { from: "codex", fromModel: "gpt", fromSettings: {} };
    const record = sanitizeSessionForPersist(session) as SessionRecord;
    invoke.mockImplementation(async (command: string) =>
      command === "session_get" ? record : null,
    );
    const restored = await getSession(session.id);
    expect(restored).toMatchObject({ id: session.id, harness: "claude", model: session.model });
    expect(restored?.blocks).toEqual(session.blocks);
    expect(restored?.providerSessionId).toBeUndefined();
    expect(restored?.pendingSwitch).toBeUndefined();
    expect(restored?.pendingContextReplay).toContain("Preserve the parser contract");
    expect(restored?.pendingContextReplay).toContain("Parser callers verified");
    expect(conversationReplayPrompt(restored!)).toContain("Preserve the parser contract");
  });

  it("caps inspection on load and budgets saved subagent inputs with their outputs", async () => {
    const record = codexRecord();
    const block = record.blocks[1];
    block.text = "Edit app.ts";
    block.tool = {
      kind: "write",
      preview: { kind: "write", inspection: { kind: "content", text: "x".repeat(50_000) } },
    };
    block.agentRun = {
      name: "Writer",
      steps: Array.from({ length: 40 }, (_, index) => ({
        id: `step-${index}`,
        kind: "tool",
        text: "Write app.ts",
        output: `useful-${index}`,
        preview: { kind: "write", inspection: { kind: "content", text: "x".repeat(24_000) } },
      })),
    };
    invoke.mockImplementation(async (command: string) =>
      command === "session_get" ? record : null,
    );
    const restored = await getSession("s1");
    const loaded = restored!.blocks[1];
    expect(loaded.tool?.preview?.inspection?.text).toHaveLength(MAX_TOOL_INSPECTION_CHARS);
    expect(loaded.tool?.preview?.inspection?.truncated).toBe(true);
    const steps = loaded.agentRun!.steps;
    expect(
      steps.reduce(
        (sum, step) =>
          sum + (step.output?.length ?? 0) + (step.preview?.inspection?.text.length ?? 0),
        0,
      ),
    ).toBeLessThanOrEqual(PERSISTED_AGENT_OUTPUT_RUN_CHARS);
    expect(steps.every((step, index) => step.output === `useful-${index}`)).toBe(true);
  });

  it("still returns the repaired session when the write fails", async () => {
    invoke.mockImplementation((cmd: string) => {
      if (cmd === "session_get") return Promise.resolve(codexRecord());
      if (cmd === "session_upsert") return Promise.reject(new Error("db locked"));
      return Promise.resolve(null);
    });

    // A failed persistence must not cost the reader the session: the repair
    // stays in memory and the next load retries the write.
    const session = await getSession("s1");
    expect(session).not.toBeNull();
    expect(session?.blocks[1].text).toBe("Find files");
  });

  it("persists the repair when the write succeeds", async () => {
    invoke.mockImplementation((cmd: string) => {
      if (cmd === "session_get") return Promise.resolve(codexRecord());
      return Promise.resolve(null);
    });

    const session = await getSession("s1");
    expect(session?.blocks[1].text).toBe("Find files");
    expect(invoke.mock.calls.some(([cmd]) => cmd === "session_upsert")).toBe(true);
  });

  it("restores rewind metadata separately from active provider transcript blocks", async () => {
    const record = codexRecord();
    record.blocks[0].turnOutcome = "stopped";
    record.blocks[0].turnStoppedAt = 789;
    record.rewindHistory = [
      {
        id: "rewind-1",
        createdAt: 123,
        fromBlockId: "removed-user",
        blocks: [{ id: "removed-user", role: "user", text: "archived only" }],
      },
    ];
    record.pendingContextReplay = "retained prefix only";
    invoke.mockImplementation(async (command: string) =>
      command === "session_get" ? record : null,
    );

    const restored = await getSession("s1");
    expect(restored?.blocks.map((block) => block.id)).toEqual(["b0", "b1"]);
    expect(restored?.blocks[0]).toMatchObject({ turnOutcome: "stopped", turnStoppedAt: 789 });
    expect(restored?.rewindHistory?.[0].blocks[0].text).toBe("archived only");
    expect(restored?.pendingContextReplay).toBe("retained prefix only");
    expect(restored?.blocks.some((block) => block.text === "archived only")).toBe(false);
  });

  it("restores a flagged host divergence as a record that locks nothing, and an answered one as answered", async () => {
    const restore = async (stored: string | undefined) => {
      const record = codexRecord();
      record.adoptedDivergence = stored;
      invoke.mockImplementation(async (command: string) =>
        command === "session_get" ? record : null,
      );
      return getSession("s1");
    };
    // A stale flag must not hold sending while the host cannot be reached (or
    // after a downgrade); only a pass that reaches the host flags it again.
    const unanswered = await restore(JSON.stringify({ key: "3:a:b:x:y" }));
    expect(unanswered).toMatchObject({ adoptedDivergence: { key: "3:a:b:x:y" } });
    expect(unanswered?.adoptedSyncConflict).toBeUndefined();
    const answered = await restore(JSON.stringify({ key: "3:a:b:x:y", keep: true }));
    expect(answered?.adoptedDivergence).toEqual({ key: "3:a:b:x:y", keep: true });
    expect(answered?.adoptedSyncConflict).toBeUndefined();
    for (const damaged of [undefined, "", "not json", "[]", '{"key":""}', '{"keep":true}'])
      expect(await restore(damaged)).not.toHaveProperty("adoptedDivergence");
  });

  it("restores the agreed base, the host head of a divergence, and ignores damaged ones", async () => {
    const restore = async (base: string | undefined, divergence?: string) => {
      const record = codexRecord();
      record.adoptedBase = base;
      record.adoptedDivergence = divergence;
      invoke.mockImplementation(async (command: string) =>
        command === "session_get" ? record : null,
      );
      return getSession("s1");
    };
    const head = { count: 2, chain: "0123456789abcdef0123456789abcdef" };
    const restored = await restore(
      JSON.stringify(head),
      JSON.stringify({ key: "heads::2.x", hostHead: head }),
    );
    expect(restored?.adoptedBase).toEqual(head);
    expect(restored?.adoptedDivergence).toEqual({ key: "heads::2.x", hostHead: head });
    for (const damaged of [
      undefined,
      "",
      "not json",
      "[]",
      '{"count":-1,"chain":""}',
      '{"count":2,"chain":"short"}',
      JSON.stringify({ count: 2, chain: "f".repeat(5_000) }),
    ])
      expect(await restore(damaged)).not.toHaveProperty("adoptedBase");
    // A damaged head does not discard the divergence it came with.
    const partial = await restore(undefined, JSON.stringify({ key: "k", hostHead: { count: 1 } }));
    expect(partial?.adoptedDivergence).toEqual({ key: "k" });
  });

  it("restores an archived conversation when rewind left no active user blocks", async () => {
    const record = codexRecord();
    record.blocks = [];
    record.rewindHistory = [
      {
        id: "rewind-empty-prefix",
        createdAt: 123,
        fromBlockId: "first-user",
        blocks: [{ id: "first-user", role: "user", text: "archived first prompt" }],
      },
    ];
    invoke.mockImplementation(async (command: string) =>
      command === "session_get" ? record : null,
    );

    const restored = await getSession("s1");
    expect(restored?.blocks).toEqual([]);
    expect(restored?.rewindHistory?.[0].blocks[0].text).toBe("archived first prompt");
  });
});
