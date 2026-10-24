import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { claudeShellCommands } from "../../../platform/tauri/fs";
import { getSession, shouldPersistSession, upsertSession } from "./sessionStore";
import { proposalBlock, type OrchestrationProposal } from "../../orchestration/model/orchestrationPlan";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("../../../platform/tauri/fs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../platform/tauri/fs")>()),
  claudeShellCommands: vi.fn(),
  ompActiveAssistantTexts: vi.fn(),
  ompSessionInterjections: vi.fn(),
}));
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
}
function record(id: string, blocks: unknown[], harness = "codex") {
  return {
    id,
    cwd: "/tmp/project",
    harness,
    model: "model",
    modelSettings: {},
    runtimeMode: "full",
    title: "Test",
    providerSessionId: harness === "claude" ? "provider" : undefined,
    blocks,
    createdAt: 1,
    updatedAt: 10,
    transcriptRevision: 7,
  };
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("window", { setTimeout: (fn: () => void, delay: number) => setTimeout(fn, delay) });
  vi.mocked(invoke).mockReset();
  vi.mocked(claudeShellCommands).mockReset();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
describe("progressive stored history", () => {
  it("recovers a raw plan revision after its proposal context arrives on an earlier page", async () => {
    const proposal: OrchestrationProposal = {
      version: 1, leadId: "proposal-pages", cwd: "/tmp/project", request: "Improve layout",
      author: { harness: "codex", model: "model", name: "Lead" },
      settings: { choices: [{ harness: "codex", model: "model", name: "Worker" }], maxWorkers: 2 },
      status: "ready", title: "Layout", summary: "Initial plan", tasks: [],
    };
    const raw = {
      id: "revision", role: "assistant", text: `<bycoda_proposal>${JSON.stringify({
        title: "Revised layout", summary: "Preserve old layout",
        tasks: [{ id: "ui", title: "Layout", prompt: "Improve layout", harness: "codex", model: "model", files: ["src"], dependsOn: [] }],
      })}</bycoda_proposal>`,
    };
    vi.mocked(invoke).mockImplementation((command, args) => {
      if (command === "session_get_page") {
        const earlier = (args as { before?: number }).before != null;
        return Promise.resolve({
          session: record("proposal-pages", earlier
            ? [{ ...proposalBlock("original", proposal), streaming: false }, { id: "u", role: "user", text: "Preserve old layout" }]
            : [raw]),
          before: earlier ? undefined : 2, totalBlocks: 3, revision: 7,
        }) as ReturnType<typeof invoke>;
      }
      return Promise.resolve([]) as ReturnType<typeof invoke>;
    });
    const onHydrated = vi.fn();
    const tail = await getSession("proposal-pages", { onHydrated });
    expect(tail?.blocks[0].orchestration).toBeUndefined();
    await vi.advanceTimersByTimeAsync(0);
    const complete = onHydrated.mock.calls.at(-1)![1];
    expect(complete.blocks[2]).toMatchObject({
      id: "revision", role: "plan", orchestration: { status: "ready", title: "Revised layout" },
    });
    expect(vi.mocked(invoke).mock.calls.some(([command]) => command === "session_upsert")).toBe(false);
  });

  it("never persists an incomplete remote view even if it has a local path", () => {
    const partial = {
      id: "partial",
      cwd: "/local/project",
      harness: "codex",
      model: "m",
      runtimeMode: "supervised",
      title: "t",
      blocks: [{ id: "u", role: "user", text: "tail" }],
      historyPartial: true,
    };
    expect(shouldPersistSession(partial as Parameters<typeof shouldPersistSession>[0])).toBe(false);
  });
  it("publishes a nonpersistable tail without waiting for earlier pages", async () => {
    const earlier = deferred<unknown>();
    const onHydrated = vi.fn();
    vi.mocked(invoke).mockImplementation((command, args) => {
      if (command === "session_get_page")
        return (
          (args as { before?: number }).before == null
            ? Promise.resolve({
                session: record("page-tail", [{ id: "a", role: "assistant", text: "tail" }]),
                before: 1,
                totalBlocks: 2,
                revision: 7,
              })
            : earlier.promise
        ) as ReturnType<typeof invoke>;
      return Promise.resolve([]) as ReturnType<typeof invoke>;
    });
    const tail = await getSession("page-tail", { onHydrated });
    expect(tail?.blocks[0].id).toBe("a");
    expect(tail?.historyLoading).toBe(true);
    expect(shouldPersistSession(tail!)).toBe(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(onHydrated).not.toHaveBeenCalled();
    earlier.resolve({
      session: record("page-tail", [{ id: "u", role: "user", text: "earlier" }]),
      totalBlocks: 2,
      revision: 7,
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(onHydrated.mock.calls[0][1].blocks.map((block: { id: string }) => block.id)).toEqual([
      "u",
      "a",
    ]);
    expect(onHydrated.mock.calls[0][1].historyLoading).toBe(false);
    expect(vi.mocked(invoke).mock.calls.filter(([name]) => name === "session_upsert")).toHaveLength(
      0,
    );
  });
  it("reports a stale page revision without exposing partial data as complete", async () => {
    const onHydrated = vi.fn(),
      onHydrationFailed = vi.fn();
    vi.mocked(invoke).mockImplementation((command, args) =>
      command === "session_get_page"
        ? (((args as { before?: number }).before == null
            ? Promise.resolve({
                session: record("page-stale", [{ id: "a", role: "assistant", text: "tail" }]),
                before: 1,
                totalBlocks: 2,
                revision: 7,
              })
            : Promise.reject(new Error("Transcript page revision changed"))) as ReturnType<
            typeof invoke
          >)
        : (Promise.resolve([]) as ReturnType<typeof invoke>),
    );
    const tail = await getSession("page-stale", { onHydrated, onHydrationFailed });
    await vi.advanceTimersByTimeAsync(0);
    expect(onHydrated).not.toHaveBeenCalled();
    expect(onHydrationFailed).toHaveBeenCalledWith(tail);
    expect(tail?.historyLoading).toBe(true);
  });
  it("uses the original revision for delayed repair racing a newly saved turn", async () => {
    const commands = deferred<Record<string, string>>();
    vi.mocked(claudeShellCommands).mockReturnValue(commands.promise);
    let writes = 0;
    vi.mocked(invoke).mockImplementation((command) => {
      if (command === "session_get_page")
        return Promise.resolve({
          session: record(
            "repair-race",
            [
              { id: "u", role: "user", text: "first" },
              {
                id: "t",
                role: "tool",
                text: "Shell",
                tool: { callId: "tool", kind: "execute", title: "Shell" },
              },
            ],
            "claude",
          ),
          totalBlocks: 2,
          revision: 7,
        }) as ReturnType<typeof invoke>;
      if (command === "session_upsert")
        return Promise.resolve(
          ++writes === 1
            ? {
                id: "repair-race",
                cwd: "/tmp/project",
                harness: "claude",
                model: "model",
                runtimeMode: "full",
                title: "Test",
                createdAt: 1,
                updatedAt: 11,
                transcriptRevision: 8,
              }
            : null,
        ) as ReturnType<typeof invoke>;
      return Promise.resolve([]) as ReturnType<typeof invoke>;
    });
    const original = await getSession("repair-race", { onHydrated: vi.fn() });
    await vi.advanceTimersByTimeAsync(0);
    await upsertSession({
      ...original!,
      blocks: [...original!.blocks, { id: "new", role: "user", text: "new turn" }],
    });
    commands.resolve({ tool: "pwd" });
    await vi.advanceTimersByTimeAsync(0);
    const writeArgs = vi
      .mocked(invoke)
      .mock.calls.filter(([name]) => name === "session_upsert")
      .map(([, args]) => args as { expectedUpdatedAt: number; expectedRevision: number });
    expect(writeArgs[1]).toMatchObject({ expectedUpdatedAt: 10, expectedRevision: 7 });
  });
});
