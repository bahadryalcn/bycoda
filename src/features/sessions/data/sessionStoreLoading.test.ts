import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { claudeShellCommands } from "../../../platform/tauri/fs";
import {
  getEarlierStoredHistory,
  getSession,
  shouldPersistSession,
  upsertSession,
} from "./sessionStore";
import {
  proposalBlock,
  type OrchestrationProposal,
} from "../../orchestration/model/orchestrationPlan";
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
  vi.stubGlobal(
    "window",
    Object.assign(new EventTarget(), {
      setTimeout: (fn: () => void, delay: number) => setTimeout(fn, delay),
    }),
  );
  vi.mocked(invoke).mockReset();
  vi.mocked(claudeShellCommands).mockReset();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
describe("progressive stored history", () => {
  it("starts the queue read with the first page and restores it once", async () => {
    const id = "parallel-tail-queue";
    const page = deferred<unknown>();
    const queue = [
      {
        id: "q1",
        text: "Keep this attachment",
        attachments: [
          {
            id: "a1",
            name: "a.txt",
            path: "/tmp/a.txt",
            kind: "file",
            mimeType: "text/plain",
            size: 8,
          },
        ],
      },
    ];
    vi.mocked(invoke).mockImplementation((command) => {
      if (command === "session_get_page") return page.promise as ReturnType<typeof invoke>;
      return Promise.resolve(command === "session_get_queue" ? queue : []) as ReturnType<
        typeof invoke
      >;
    });
    const opening = getSession(id, { deferHistory: true });
    await vi.advanceTimersByTimeAsync(0);
    const pendingReads = vi.mocked(invoke).mock.calls.map(([command]) => command);
    page.resolve({ session: record(id, []), before: 20, totalBlocks: 20, revision: 7 });
    const tail = await opening;
    expect(pendingReads).toEqual(expect.arrayContaining(["session_get_page", "session_get_queue"]));
    expect(pendingReads).not.toContain("inspect_paths");
    expect(tail?.storedHistory).toEqual({ before: 20, revision: 7 });
    expect(tail?.queueStatus).toBe("restored");
    expect(tail?.queuedMessages?.[0]).toMatchObject({
      id: "q1",
      attachments: [{ id: "a1", missing: true }],
    });
    expect(
      vi.mocked(invoke).mock.calls.filter(([command]) => command === "session_get_queue"),
    ).toHaveLength(1);
  });
  it("rebinds metadata-only image attachments on both pages of an adopted transcript", async () => {
    const id = "adopted-images";
    const machine = {
      id: "local-host",
      environmentId: "local-environment",
      localHost: true,
      endpoint: "http://127.0.0.1:3776",
    };
    const recentImageId = "00000000-0000-4000-8000-000000000001";
    const olderImageId = "00000000-0000-4000-8000-000000000002";
    const block = (id: string) => ({
      id,
      role: "user",
      text: "Image attached",
      attachments: [{ id, name: "image.png", kind: "image", mimeType: "image/png", size: 3 }],
    });
    vi.mocked(invoke).mockImplementation(async (command, args) => {
      if (command === "remote_machines")
        return [{ ...machine, id: "remote-host", localHost: false }, machine] as never;
      if (command === "remote_request") return { data: "YWJj", offset: 3, size: 3 } as never;
      if (command !== "session_get_page") return [] as never;
      const earlier = (args as { before?: number }).before !== undefined;
      const message = block(earlier ? olderImageId : recentImageId);
      const image = message.attachments[0]!;
      return {
        session: {
          ...record(id, [
            {
              ...message,
              attachments: [
                image,
                { ...image, id: "with-path", path: "/tmp/image.png" },
                { ...image, id: "other-host", hostEnvironmentId: "other-environment" },
              ],
            },
          ]),
          adoptedBase: JSON.stringify({ count: 2, chain: "a".repeat(32) }),
        },
        before: earlier ? undefined : 1,
        totalBlocks: 2,
        revision: 7,
      } as never;
    });

    const session = await getSession(id, { deferHistory: true });
    const earlier = await getEarlierStoredHistory(session!);
    expect(invoke).not.toHaveBeenCalledWith("remote_request", expect.anything());
    await expect(session?.blocks[0]?.attachments?.[0]?.loadPreview?.()).resolves.toBe("YWJj");
    await expect(earlier?.blocks[0]?.attachments?.[0]?.loadPreview?.()).resolves.toBe("YWJj");
    expect(session?.blocks[0]?.attachments?.[1]?.loadPreview).toBeUndefined();
    await expect(session?.blocks[0]?.attachments?.[2]?.loadPreview?.()).rejects.toThrow(
      "owning Host",
    );
    expect(
      vi.mocked(invoke).mock.calls.filter(([command]) => command === "remote_request"),
    ).toHaveLength(2);
    for (const attachmentId of [recentImageId, olderImageId])
      expect(invoke).toHaveBeenCalledWith(
        "remote_request",
        expect.objectContaining({
          machineId: machine.id,
          expectedEnvironmentId: machine.environmentId,
          method: "attachments.read",
          params: { sessionId: id, id: attachmentId, offset: 0 },
        }),
      );
  });

  it("opens with ten recent turns and reads older blocks only on demand", async () => {
    const id = "on-demand-history";
    const blocks = Array.from({ length: 64 }, (_, index) => ({
      id: `block-${index}`,
      role: index % 2 === 0 ? "user" : "assistant",
      text: `Message ${index}`,
    }));
    vi.mocked(invoke).mockImplementation((command, args) => {
      if (command === "session_get_page") {
        const { before, limit } = args as { before?: number; limit: number };
        const end = before ?? blocks.length;
        const start = Math.max(0, end - limit);
        return Promise.resolve({
          session: record(id, blocks.slice(start, end)),
          before: start || undefined,
          totalBlocks: blocks.length,
          revision: 7,
        }) as ReturnType<typeof invoke>;
      }
      return Promise.resolve([]) as ReturnType<typeof invoke>;
    });
    const window = await getSession(id, { deferHistory: true });
    expect(window?.blocks.map((block) => block.id)).toEqual(
      blocks.slice(44).map((block) => block.id),
    );
    expect(shouldPersistSession(window!)).toBe(false);
    await vi.advanceTimersByTimeAsync(500);
    expect(
      vi.mocked(invoke).mock.calls.filter(([command]) => command === "session_get_page"),
    ).toEqual([["session_get_page", { sessionId: id, limit: 48 }]]);
    const page = await getEarlierStoredHistory(window!);
    expect(invoke).toHaveBeenLastCalledWith("session_get_page", {
      sessionId: id,
      before: 44,
      revision: 7,
      limit: 80,
    });
    expect(page?.cursor.before).toBeUndefined();
    expect([...page!.blocks, ...window!.blocks].map((block) => block.id)).toEqual(
      blocks.map((block) => block.id),
    );
  });
  it("recovers a raw plan revision after its proposal context arrives on an earlier page", async () => {
    const proposal: OrchestrationProposal = {
      version: 1,
      leadId: "proposal-pages",
      cwd: "/tmp/project",
      request: "Improve layout",
      author: { harness: "codex", model: "model", name: "Lead" },
      settings: { choices: [{ harness: "codex", model: "model", name: "Worker" }], maxWorkers: 2 },
      status: "ready",
      title: "Layout",
      summary: "Initial plan",
      tasks: [],
    };
    const raw = {
      id: "revision",
      role: "assistant",
      text: `<bycoda_proposal>${JSON.stringify({
        title: "Revised layout",
        summary: "Preserve old layout",
        tasks: [
          {
            id: "ui",
            title: "Layout",
            prompt: "Improve layout",
            harness: "codex",
            model: "model",
            files: ["src"],
            dependsOn: [],
          },
        ],
      })}</bycoda_proposal>`,
    };
    vi.mocked(invoke).mockImplementation((command, args) => {
      if (command === "session_get_page") {
        const earlier = (args as { before?: number }).before != null;
        return Promise.resolve({
          session: record(
            "proposal-pages",
            earlier
              ? [
                  { ...proposalBlock("original", proposal), streaming: false },
                  { id: "u", role: "user", text: "Preserve old layout" },
                ]
              : [raw],
          ),
          before: earlier ? undefined : 2,
          totalBlocks: 3,
          revision: 7,
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
      id: "revision",
      role: "plan",
      orchestration: { status: "ready", title: "Revised layout" },
    });
    expect(vi.mocked(invoke).mock.calls.some(([command]) => command === "session_upsert")).toBe(
      false,
    );
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
