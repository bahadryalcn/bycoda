import { describe, expect, it, vi } from "vitest";
import {
  recordVoiceWork,
  runVoiceWork,
  voiceWorkAlreadyStarted,
  voiceWorkCall,
  voiceWorkCreates,
} from "./voiceWorkGuard";
import { VoiceWorkLedger, type VoiceWorkEntry, type VoiceWorkStorage } from "./voiceWorkLedger";

function ledger() {
  let saved: VoiceWorkEntry[] = [];
  const storage: VoiceWorkStorage = {
    load: () => saved,
    save: (entries) => {
      saved = [...entries];
    },
  };
  return new VoiceWorkLedger({ storage });
}
const create = (requestId: string) => ({
  family: "workspace",
  action: "workspace.sessions.create",
  requestId,
  input: { projectPath: "C:\\p\\game", prompt: "build a game", submit: true, requestId },
});
const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("voiceWorkCall", () => {
  it("records app tool input without request ids, keeping the project", () => {
    expect(voiceWorkCall("app_tool_call", create("r1"))).toEqual({
      tool: "app_tool_call",
      action: "workspace.sessions.create",
      requestId: "r1",
      args: { projectPath: "C:\\p\\game", prompt: "build a game", submit: true },
      projectPath: "C:\\p\\game",
    });
  });

  it("links submit_work to the bound session and falls back to the turn project", () => {
    expect(
      voiceWorkCall("submit_work", { text: "fix it" }, { sessionId: "s1", projectPath: "C:\\p" }),
    ).toEqual({
      tool: "submit_work",
      args: { text: "fix it", sessionId: "s1" },
      projectPath: "C:\\p",
    });
  });
});

describe("voiceWorkCreates", () => {
  it("covers only work-creating calls", () => {
    expect(voiceWorkCreates(voiceWorkCall("give_jobs", { jobs: [] }))).toBe(true);
    expect(voiceWorkCreates(voiceWorkCall("submit_work", { text: "x" }))).toBe(true);
    expect(voiceWorkCreates(voiceWorkCall("app_tool_call", create("r")))).toBe(true);
    expect(
      voiceWorkCreates(
        voiceWorkCall("app_tool_call", { action: "workspace.sessions.submit", input: {} }),
      ),
    ).toBe(true);
    expect(
      voiceWorkCreates(
        voiceWorkCall("app_tool_call", {
          action: "workspace.sessions.create",
          input: { prompt: "x", submit: false },
        }),
      ),
    ).toBe(false);
    for (const action of ["workspace.sessions.stop", "commands.run", "tasks.create"])
      expect(voiceWorkCreates(voiceWorkCall("app_tool_call", { action, input: {} }))).toBe(false);
    expect(voiceWorkCreates(voiceWorkCall("stop_work", {}))).toBe(false);
  });
});

describe("runVoiceWork", () => {
  it("settles the entry from the tool promise", async () => {
    const work = ledger();
    let finish!: (value: unknown) => void;
    const result = runVoiceWork(
      work,
      voiceWorkCall("app_tool_call", create("r1")),
      "build me a game",
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    expect(work.entries()[0]).toMatchObject({ id: "r1", status: "running" });
    finish({ status: "accepted", sessionId: "s1" });
    await result;
    await settled();
    expect(work.entries()[0]).toMatchObject({ status: "done", sessionIds: ["s1"] });
  });

  it("guards only work started before the current voice connection", async () => {
    const work = ledger();
    await runVoiceWork(work, voiceWorkCall("submit_work", { text: "Fix login" }), "fix login", () =>
      Promise.resolve({ accepted: true }),
    );
    await settled();
    const startedAt = work.entries()[0]!.startedAt;
    const execute = vi.fn(async () => ({ accepted: true }));
    // Same connection: the model still holds the result, the tool's own replay rules apply.
    await runVoiceWork(
      work,
      voiceWorkCall("submit_work", { text: "Fix login" }),
      "fix login",
      execute,
      startedAt,
    );
    expect(execute).toHaveBeenCalledOnce();
    // A later connection has forgotten it: answer from the ledger.
    const retry = await runVoiceWork(
      work,
      voiceWorkCall("submit_work", { text: "Fix login" }),
      "fix login",
      execute,
      work.entries()[0]!.startedAt + 1,
    );
    expect(execute).toHaveBeenCalledOnce();
    expect(retry).toMatchObject({ status: "already_started" });
  });

  it("answers an identical retry for the same request without executing it", async () => {
    const work = ledger();
    await runVoiceWork(work, voiceWorkCall("app_tool_call", create("r1")), "build a game", () =>
      Promise.resolve({ status: "accepted", sessionId: "s1" }),
    );
    await settled();
    const execute = vi.fn(async () => ({ status: "accepted", sessionId: "s2" }));
    const retry = await runVoiceWork(
      work,
      voiceWorkCall("app_tool_call", create("r2")),
      "build a game",
      execute,
    );
    expect(execute).not.toHaveBeenCalled();
    expect(retry).toMatchObject({ status: "already_started", sessionIds: ["s1"], state: "done" });
    await runVoiceWork(
      work,
      voiceWorkCall("app_tool_call", create("r3")),
      "one more game",
      execute,
    );
    expect(execute).toHaveBeenCalledOnce();
  });

  it("never guards stops or other commands", async () => {
    const work = ledger();
    const execute = vi.fn(async () => ({ status: "accepted" }));
    const stop = voiceWorkCall("app_tool_call", {
      action: "workspace.sessions.stop",
      input: { sessionId: "s1" },
    });
    await runVoiceWork(work, stop, "stop it", execute);
    await settled();
    await runVoiceWork(work, stop, "stop it", execute);
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("settles a rejected tool as uncertain and still rejects to the caller", async () => {
    const work = ledger();
    await expect(
      runVoiceWork(work, voiceWorkCall("submit_work", { text: "x" }), "fix it", () =>
        Promise.reject(new Error("socket closed")),
      ),
    ).rejects.toThrow("socket closed");
    await settled();
    expect(work.entries()[0]).toMatchObject({ status: "uncertain", outcome: "socket closed" });
  });

  it("drops calls that dispatched nothing", async () => {
    const work = ledger();
    await runVoiceWork(work, voiceWorkCall("give_jobs", { jobs: [] }), "x", async () => ({
      status: "refused",
    }));
    await settled();
    expect(work.entries()).toHaveLength(0);
  });
});

describe("recordVoiceWork", () => {
  it("records without the duplicate guard", async () => {
    const work = ledger();
    const call = voiceWorkCall("submit_work", { text: "x" }, { sessionId: "s1" });
    const execute = vi.fn(async () => ({ accepted: true }));
    await recordVoiceWork(work, call, "fix it", execute);
    await settled();
    await recordVoiceWork(work, call, "fix it", execute);
    expect(execute).toHaveBeenCalledTimes(2);
  });
});

it("describes existing work without claiming a new dispatch", () => {
  const entry: VoiceWorkEntry = {
    id: "w1",
    tool: "give_jobs",
    request: "x",
    startedAt: 1,
    status: "running",
    sessionIds: [],
    jobIds: ["j1"],
  };
  const result = voiceWorkAlreadyStarted(entry);
  expect(result).toMatchObject({ status: "already_started", workId: "w1", jobIds: ["j1"] });
  expect(result).not.toHaveProperty("accepted");
  expect(result.next).toMatch(/nothing new was dispatched/);
});
