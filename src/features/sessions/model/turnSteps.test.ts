import { describe, expect, it } from "vitest";
import type { CodexEntry } from "../../../platform/tauri/sessionImport";
import { INTERRUPT_MESSAGE, markTurnInterrupted } from "./inFlight";
import { newSession, type Block, type Session } from "./session";
import { withFinishedTurn } from "./turnRecovery";
import { EARLIER_STEPS_NOTE, withTurnSteps } from "./turnSteps";

// Synthetic transcripts only: the shapes of the CLI records, none of their content.
const line = (record: unknown) => JSON.stringify(record);
const claudePrompt = (text: string) =>
  line({
    type: "user",
    timestamp: "2026-05-01T10:00:00.000Z",
    message: { role: "user", content: text },
  });
const claudeToolUse = (id: string, command: string) =>
  line({
    type: "assistant",
    message: {
      id: `m-${id}`,
      role: "assistant",
      stop_reason: "tool_use",
      content: [{ type: "tool_use", id, name: "Bash", input: { command } }],
    },
  });
const claudeToolResult = (id: string, output: string) =>
  line({
    type: "user",
    message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content: output }] },
  });
const claudeReply = (id: string, text: string, stop = "end_turn") =>
  line({
    type: "assistant",
    message: { id, role: "assistant", stop_reason: stop, content: [{ type: "text", text }] },
  });

const user: Block = { id: "u1", role: "user", text: "fix the bug" };
const chat = (blocks: Block[]): Session => ({
  ...newSession("claude", "/tmp/a"),
  providerSessionId: "p1",
  blocks,
});
const roles = (session: Session) => session.blocks.map((block) => block.role);
const tools = (session: Session) =>
  session.blocks
    .filter((block) => block.tool)
    .map((block) => [block.tool?.callId, block.tool?.status]);

const finishedTurn = [
  claudePrompt("fix the bug"),
  claudeToolUse("t1", "ls"),
  claudeToolResult("t1", "a.txt"),
  claudeToolUse("t2", "cat a.txt"),
  claudeToolResult("t2", "hello"),
  claudeReply("m9", "Fixed."),
].join("\n");

describe("withTurnSteps (Claude)", () => {
  it("rebuilds a finished turn's tool calls and reply after the prompt", () => {
    const interrupted = markTurnInterrupted({ ...chat([user]), busy: true });
    const next = withTurnSteps(interrupted, { text: finishedTurn, startReached: true }, "finished");
    expect(roles(next)).toEqual(["user", "tool", "tool", "assistant"]);
    expect(tools(next)).toEqual([
      ["t1", "completed"],
      ["t2", "completed"],
    ]);
    expect(next.blocks[1].tool?.detail).toBe("a.txt");
    // The quit note is gone, and the final reply is not added a second time.
    expect(next.blocks.some((block) => block.text === INTERRUPT_MESSAGE)).toBe(false);
    const done = withFinishedTurn(next, "Fixed.");
    expect(done.blocks.filter((block) => block.role === "assistant")).toHaveLength(1);
  });

  it("adds only what is missing when the live stream stored part of the turn", () => {
    const stored: Block[] = [
      user,
      {
        id: "b1",
        role: "tool",
        text: "ls",
        tool: { callId: "t1", title: "ls", kind: "execute", status: "completed", detail: "a.txt" },
      },
    ];
    const next = withTurnSteps(
      chat(stored),
      { text: finishedTurn, startReached: true },
      "finished",
    );
    expect(roles(next)).toEqual(["user", "tool", "tool", "assistant"]);
    expect(next.blocks[1]).toBe(stored[1]);
    expect(tools(next)).toEqual([
      ["t1", "completed"],
      ["t2", "completed"],
    ]);
  });

  it("is idempotent: a second pass over a complete turn changes nothing", () => {
    const once = withTurnSteps(
      chat([user]),
      { text: finishedTurn, startReached: true },
      "finished",
    );
    const twice = withTurnSteps(once, { text: finishedTurn, startReached: true }, "finished");
    expect(twice.blocks.map((block) => block.id)).toEqual(once.blocks.map((block) => block.id));
  });

  it("completes a reply the quit cut short and a tool the quit froze", () => {
    const stored: Block[] = [
      user,
      { id: "b1", role: "assistant", text: "Let me look", streaming: false },
      {
        id: "b2",
        role: "tool",
        text: "ls",
        tool: { callId: "t1", title: "ls", kind: "execute", status: "cancelled" },
      },
    ];
    const steps = [
      claudePrompt("fix the bug"),
      claudeReply("m0", "Let me look at the files first.", "tool_use"),
      claudeToolUse("t1", "ls"),
      claudeToolResult("t1", "a.txt"),
      claudeReply("m9", "Done."),
    ].join("\n");
    const next = withTurnSteps(chat(stored), { text: steps, startReached: true }, "finished");
    expect(next.blocks[1]).toMatchObject({ id: "b1", text: "Let me look at the files first." });
    expect(next.blocks[2]).toMatchObject({ id: "b2" });
    expect(next.blocks[2].tool).toMatchObject({
      status: "completed",
      detail: "a.txt",
      callId: "t1",
    });
    expect(next.blocks[3]).toMatchObject({ role: "assistant", text: "Done." });
    expect(next.blocks).toHaveLength(4);
  });

  it("shows the steps an interrupted turn recorded, then the note, with open work sealed", () => {
    const cut = [
      claudePrompt("fix the bug"),
      claudeToolUse("t1", "ls"),
      claudeToolResult("t1", "a.txt"),
      claudeToolUse("t2", "sleep 100"),
    ].join("\n");
    const interrupted = markTurnInterrupted({ ...chat([user]), busy: true });
    const next = withTurnSteps(interrupted, { text: cut, startReached: true }, "interrupted");
    expect(roles(next)).toEqual(["user", "tool", "tool", "system"]);
    expect(next.blocks[3].text).toBe(INTERRUPT_MESSAGE);
    expect(next.blocks[3].notice).toBe("interrupt");
    expect(tools(next)).toEqual([
      ["t1", "completed"],
      ["t2", "cancelled"],
    ]);
    expect(next.busy).toBe(false);
  });

  it("marks a turn longer than the read, and shows its tail instead of pretending", () => {
    const tail = [
      claudeToolUse("t8", "make"),
      claudeToolResult("t8", "ok"),
      claudeReply("m9", "Built."),
    ].join("\n");
    const next = withTurnSteps(chat([user]), { text: tail, startReached: false }, "finished");
    expect(roles(next)).toEqual(["user", "system", "tool", "assistant"]);
    expect(next.blocks[1].text).toBe(EARLIER_STEPS_NOTE);
  });

  it("does not claim missing steps when the session already holds the turn's earlier ones", () => {
    const stored: Block[] = [
      user,
      {
        id: "b1",
        role: "tool",
        text: "make",
        tool: { callId: "t8", title: "make", kind: "execute", status: "completed" },
      },
    ];
    const tail = [
      claudeToolUse("t8", "make"),
      claudeToolResult("t8", "ok"),
      claudeReply("m9", "Built."),
    ].join("\n");
    const next = withTurnSteps(chat(stored), { text: tail, startReached: false }, "finished");
    expect(roles(next)).toEqual(["user", "tool", "assistant"]);
  });

  it("leaves the session alone when the records are another turn's", () => {
    const session = chat([user]);
    const other = [claudePrompt("something else entirely"), claudeReply("m1", "ok")].join("\n");
    expect(withTurnSteps(session, { text: other, startReached: true }, "finished")).toBe(session);
  });

  it("leaves the session alone when stored steps and records do not overlap", () => {
    const stored: Block[] = [
      user,
      {
        id: "b1",
        role: "tool",
        text: "x",
        tool: { callId: "other", title: "x", kind: "execute", status: "completed" },
      },
    ];
    const session = chat(stored);
    expect(withTurnSteps(session, { text: finishedTurn, startReached: true }, "finished")).toBe(
      session,
    );
  });

  it("accepts a prompt the app added context to", () => {
    const session = chat([user]);
    const steps = [
      claudePrompt("fix the bug\n\n[attached: notes.md]"),
      claudeReply("m1", "Done."),
    ].join("\n");
    expect(
      withTurnSteps(session, { text: steps, startReached: true }, "finished").blocks,
    ).toHaveLength(2);
  });

  it("does nothing without a user block or without records", () => {
    const empty = chat([]);
    expect(withTurnSteps(empty, { text: finishedTurn, startReached: true }, "finished")).toBe(
      empty,
    );
    const session = chat([user]);
    expect(withTurnSteps(session, { text: "", startReached: true }, "finished")).toBe(session);
    expect(withTurnSteps(session, { startReached: true }, "finished")).toBe(session);
  });
});

describe("withTurnSteps (Codex)", () => {
  const entries = (calls: string[]): CodexEntry[] => [
    { kind: "user", at: 1, text: "fix the bug" },
    ...calls.map((id, index) => ({
      kind: "tool" as const,
      at: 2 + index,
      callId: id,
      name: "shell_command",
      input: `echo ${id}`,
      output: "Exit code: 0\nOutput:\nfine",
    })),
    { kind: "assistant", at: 9, text: "All done." },
  ];
  const codexChat = (blocks: Block[]): Session => ({
    ...newSession("codex", "/tmp/a"),
    providerSessionId: "p1",
    blocks,
  });

  it("rebuilds a finished turn's commands and reply", () => {
    const next = withTurnSteps(
      codexChat([user]),
      { entries: entries(["c1", "c2"]), startReached: true },
      "finished",
    );
    expect(roles(next)).toEqual(["user", "tool", "tool", "assistant"]);
    expect(tools(next).map(([, status]) => status)).toEqual(["completed", "completed"]);
  });

  it("does not repeat a command the live stream stored, even under another id", () => {
    const built = withTurnSteps(
      codexChat([user]),
      { entries: entries(["c1"]), startReached: true },
      "finished",
    );
    const liveRow: Block = {
      ...built.blocks[1],
      id: "live",
      tool: { ...built.blocks[1].tool!, callId: "item-7" },
    };
    const next = withTurnSteps(
      codexChat([user, liveRow]),
      { entries: entries(["c1", "c2"]), startReached: true },
      "finished",
    );
    expect(roles(next)).toEqual(["user", "tool", "tool", "assistant"]);
    expect(next.blocks[1].id).toBe("live");
  });

  it("shows an interrupted Codex turn's recorded steps before the note", () => {
    const cut = entries(["c1"]).slice(0, 2);
    const interrupted = markTurnInterrupted({ ...codexChat([user]), busy: true });
    const next = withTurnSteps(interrupted, { entries: cut, startReached: true }, "interrupted");
    expect(roles(next)).toEqual(["user", "tool", "system"]);
  });
});
