import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionRecord } from "./sessionStore";
import { MAX_TOOL_INSPECTION_CHARS } from "../model/toolInspection";
import { PERSISTED_AGENT_OUTPUT_RUN_CHARS } from "../model/agentOutput";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invoke(...args) }));

const { getSession } = await import("./sessionStore");

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
});
