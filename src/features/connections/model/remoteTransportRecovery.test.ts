// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { loadRemoteSession, sessionAccessForMachine } from "./connections";
import type { HostSession } from "./protocol";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
beforeEach(() => vi.clearAllMocks());
const tail: HostSession = {
  projectId: "p",
  revision: 2,
  updatedAt: 2,
  status: "idle",
  session: {
    id: "slow-tail",
    cwd: "/project",
    harness: "codex",
    model: "test",
    runtimeMode: "supervised",
    title: "Slow transfer",
    blocks: [{ id: "tail", role: "assistant", text: "ready" }],
  },
};

it("shares a slow chunked page while a command completes independently", async () => {
  const serialized = JSON.stringify({ kind: "snapshot", value: tail });
  let release!: (value: { data: string }) => void;
  const slow = new Promise<{ data: string }>((resolve) => {
    release = resolve;
  });
  vi.mocked(invoke).mockImplementation(async (_command, input) => {
    const { method } = input as { method: string };
    if (method === "sessions.page")
      return {
        sync: {
          kind: "chunked",
          transfer: "slow-transfer",
          length: serialized.length,
        },
        before: 20,
        totalBlocks: 21,
        revision: 2,
      };
    if (method === "sessions.syncChunk") return slow;
    if (method === "commands.dispatch") return { commandId: "stop", revision: 3 };
    throw new Error(method);
  });
  const first = loadRemoteSession("slow-machine", "slow-tail", undefined, {
    pages: true,
  });
  const second = loadRemoteSession("slow-machine", "slow-tail", undefined, {
    pages: true,
  });
  await vi.waitFor(() =>
    expect(
      vi
        .mocked(invoke)
        .mock.calls.filter((call) => (call[1] as any).method === "sessions.syncChunk"),
    ).toHaveLength(1),
  );
  await expect(
    sessionAccessForMachine("slow-machine").dispatch({
      type: "cancel",
      sessionId: "slow-tail",
      commandId: "stop",
    }),
  ).resolves.toMatchObject({ revision: 3 });
  release({ data: serialized });
  const [a, b] = await Promise.all([first, second]);
  expect(a.session.blocks[0]?.text).toBe("ready");
  expect(b.history?.before).toBe(20);
  expect(
    vi.mocked(invoke).mock.calls.filter((call) => (call[1] as any).method === "sessions.page"),
  ).toHaveLength(1);
});

it.each([0, 32 * 1024 * 1024 + 1, Number.NaN])(
  "rejects unsafe transfer length %s without fetching a chunk",
  async (length) => {
    vi.mocked(invoke).mockResolvedValue({
      sync: { kind: "chunked", transfer: "bad", length },
      totalBlocks: 1,
      revision: 2,
    });
    await expect(
      loadRemoteSession("bad-machine", "bad-tail", undefined, { pages: true }),
    ).rejects.toThrow("safety limit");
    expect(invoke).toHaveBeenCalledTimes(1);
  },
);

it("does not retain a failed chunk flight and can retry the same page", async () => {
  let failed = true;
  vi.mocked(invoke).mockImplementation(async (_command, input) => {
    const { method } = input as { method: string };
    if (method === "sessions.page")
      return failed
        ? {
            sync: { kind: "chunked", transfer: "retry", length: 10 },
            totalBlocks: 1,
            revision: 2,
          }
        : {
            sync: { kind: "snapshot", value: tail },
            totalBlocks: 1,
            revision: 2,
          };
    if (method === "sessions.syncChunk") return { data: "" };
    throw new Error(method);
  });
  await expect(
    loadRemoteSession("retry-machine", "slow-tail", undefined, { pages: true }),
  ).rejects.toThrow("invalid chunk");
  failed = false;
  await expect(
    loadRemoteSession("retry-machine", "slow-tail", undefined, { pages: true }),
  ).resolves.toMatchObject({ revision: 2 });
});
