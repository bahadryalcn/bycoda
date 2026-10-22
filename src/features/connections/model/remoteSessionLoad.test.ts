// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import type { HostSession } from "./protocol";
import { loadRemoteHistoryPage, loadRemoteSession } from "./connections";
import { canApplyRemotePreview } from "./remotePreviewBinding";
import { canCacheRemoteSnapshot } from "./remoteHistoryGeneration";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
beforeEach(() => vi.clearAllMocks());

const snapshot = (): HostSession => ({
  projectId: "p",
  revision: 1,
  updatedAt: 11,
  status: "running",
  session: {
    id: "load-session",
    cwd: "/tmp",
    harness: "codex",
    model: "test",
    runtimeMode: "supervised",
    title: "Test",
    blocks: [
      {
        id: "user",
        role: "user",
        text: "ready text",
        attachments: [
          { id: "load-image", name: "x.png", kind: "image", mimeType: "image/png", size: 3 },
        ],
      },
    ],
  },
});

it("publishes text and running status without waiting for an image RPC", async () => {
  let finish!: (chunk: { data: string; offset: number; size: number }) => void;
  const image = new Promise((resolve) => {
    finish = resolve;
  });
  const base = snapshot();
  vi.mocked(invoke).mockImplementation(async (_command, input) => {
    const { method } = input as { method: string };
    if (method === "sessions.sync") return { kind: "snapshot", value: base };
    if (method === "attachments.read") return image;
    if (method === "commands.dispatch") return { revision: 2 };
    throw new Error(method);
  });
  const onPreviews = vi.fn();
  const visible = await loadRemoteSession("m", "load-session", undefined, { onPreviews });
  expect(visible.session.blocks[0]!.text).toBe("ready text");
  expect(visible.status).toBe("running");
  expect(onPreviews).not.toHaveBeenCalled();
  finish({ data: btoa("abc"), offset: 3, size: 3 });
  await vi.waitFor(() => expect(onPreviews).toHaveBeenCalledOnce());
});

it.each([false, true])(
  "binds document readers on the first visible remote snapshot (pages: %s)",
  async (pages) => {
    const base = snapshot();
    base.session.blocks[0].attachments = [
      {
        id: "first-document",
        name: "report.pdf",
        kind: "file",
        mimeType: "application/pdf",
        size: 3,
        path: "/foreign-host/report.pdf",
      },
    ];
    vi.mocked(invoke).mockImplementation(async (_command, input) => {
      const { machineId, method, params } = input as {
        machineId: string;
        method: string;
        params: { id?: string };
      };
      expect(machineId).toBe("document-owner");
      if (method === "sessions.sync") return { kind: "snapshot", value: base };
      if (method === "sessions.page")
        return { sync: { kind: "snapshot", value: base }, totalBlocks: 1, revision: 1 };
      if (method === "attachments.read") {
        expect(params.id).toBe("first-document");
        return { data: btoa("pdf"), offset: 3, size: 3 };
      }
      throw new Error(method);
    });
    const visible = await loadRemoteSession("document-owner", "load-session", undefined, {
      pages,
      onPreviews: vi.fn(),
      isCurrent: () => false,
    });
    expect(
      vi
        .mocked(invoke)
        .mock.calls.some(
          ([, input]) => (input as { method: string }).method === "attachments.read",
        ),
    ).toBe(false);
    const attachment = visible.session.blocks[0].attachments![0];
    expect(attachment.loadPreview).toBeTypeOf("function");
    expect(await attachment.loadPreview!()).toBe(btoa("pdf"));
  },
);

it("rejects stale or narrower preview snapshots", () => {
  const old = snapshot();
  expect(canApplyRemotePreview(old, old)).toBe(true);
  expect(canApplyRemotePreview({ ...old, session: { ...old.session, id: "other" } }, old)).toBe(
    false,
  );
  expect(canApplyRemotePreview({ ...old, revision: 2 }, old)).toBe(false);
  expect(
    canApplyRemotePreview(
      { ...old, session: { ...old.session, blocks: [{ ...old.session.blocks[0]!, id: "other" }] } },
      old,
    ),
  ).toBe(false);
  expect(
    canApplyRemotePreview({ ...old, history: { before: 1, revision: 1, totalBlocks: 2 } }, old),
  ).toBe(false);
});

it("preserves attachment previews for callers that need one complete snapshot", async () => {
  const base = snapshot();
  vi.mocked(invoke).mockImplementation(async (_command, input) => {
    const { method } = input as { method: string };
    if (method === "sessions.sync") return { kind: "snapshot", value: base };
    if (method === "attachments.read") return { data: btoa("abc"), offset: 3, size: 3 };
    throw new Error(method);
  });
  const complete = await loadRemoteSession("m", "load-session");
  expect(complete.session.blocks[0]!.attachments![0]!.data).toBe(btoa("abc"));
});

it("opens with the tail and loads one older page only after an explicit request", async () => {
  const base = snapshot();
  const older = {
    ...base,
    session: {
      ...base.session,
      blocks: [{ id: "earlier", role: "user" as const, text: "earlier" }],
    },
  };
  vi.mocked(invoke).mockImplementation(async (_command, input) => {
    const { method, params } = input as { method: string; params: { before?: number } };
    if (method !== "sessions.page") throw new Error(method);
    return params.before === undefined
      ? { sync: { kind: "snapshot", value: base }, before: 1, totalBlocks: 2, revision: 1 }
      : { sync: { kind: "snapshot", value: older }, totalBlocks: 2, revision: 1 };
  });
  const tail = await loadRemoteSession("m", "load-session", undefined, { pages: true });
  expect(tail.session.blocks.map((block) => block.id)).toEqual(["user"]);
  expect(tail.history).toEqual({ before: 1, revision: 1, totalBlocks: 2 });
  expect(tail.historyLoading).toBeUndefined();
  expect(canCacheRemoteSnapshot(tail)).toBe(true);
  expect(vi.mocked(invoke)).toHaveBeenCalledTimes(1);
  const full = await loadRemoteHistoryPage("m", "load-session", tail);
  expect(full?.session.blocks.map((block) => block.id)).toEqual(["earlier", "user"]);
  expect(full?.history?.before).toBeUndefined();
  expect(vi.mocked(invoke)).toHaveBeenCalledTimes(2);
});

it("discards stale history pages without replacing live output or deleted blocks", async () => {
  const base = snapshot();
  vi.mocked(invoke).mockImplementation(async (_command, input) => {
    const { method } = input as { method: string };
    if (method !== "sessions.page") throw new Error(method);
    return {
      sync: {
        kind: "snapshot",
        value: {
          ...base,
          session: { ...base.session, blocks: [{ id: "old", role: "user", text: "old" }] },
        },
      },
      totalBlocks: 2,
      revision: 1,
    };
  });
  const current = {
    ...base,
    history: { before: 1, revision: 1, totalBlocks: 2 },
    session: {
      ...base.session,
      blocks: [
        ...base.session.blocks,
        { id: "live", role: "assistant" as const, text: "live output" },
      ],
    },
  };
  expect(await loadRemoteHistoryPage("m", "load-session", current, () => false)).toBeUndefined();
  expect(
    await loadRemoteHistoryPage("m", "load-session", { ...current, revision: 2 }),
  ).toBeUndefined();
  expect(current.session.blocks.at(-1)?.text).toBe("live output");
});

it("sends every loaded block ID for capable lazy-history hosts", async () => {
  const base = snapshot();
  const known = {
    ...base,
    session: {
      ...base.session,
      blocks: [
        ...base.session.blocks,
        { id: "middle", role: "assistant" as const, text: "middle" },
        { id: "last", role: "assistant" as const, text: "last" },
      ],
    },
    history: { before: 8, revision: 1, totalBlocks: 10 },
  };
  vi.mocked(invoke).mockResolvedValue({ kind: "unchanged", revision: 1 });
  await loadRemoteSession("m", "load-session", known, { partialHistory: true });
  const call = vi.mocked(invoke).mock.calls[0]![1] as {
    method: string;
    params: { partial?: boolean; loadedBlockIds?: string[]; windowStart?: number };
  };
  expect(call.method).toBe("sessions.sync");
  expect(call.params.partial).toBe(true);
  expect(call.params.loadedBlockIds).toEqual(["user", "middle", "last"]);
  expect(call.params.windowStart).toBe(8);
});

it("keeps an old-host loaded window on unchanged revision and resets to the fresh tail on change", async () => {
  const known = {
    ...snapshot(),
    revision: 4,
    history: { before: 2, revision: 4, totalBlocks: 3 },
    session: {
      ...snapshot().session,
      blocks: [
        { id: "loaded-older", role: "user" as const, text: "older" },
        ...snapshot().session.blocks,
      ],
    },
  };
  vi.mocked(invoke).mockImplementation(async (_command, input) => {
    const { method, params } = input as { method: string; params: { sessionId: string } };
    expect(method).toBe("sessions.page");
    return {
      sync: { kind: "snapshot", value: { ...snapshot(), revision: 5 } },
      before: 1,
      totalBlocks: 4,
      revision: 5,
    };
  });
  const changed = await loadRemoteSession("m", "load-session", known, { pages: true });
  expect(changed.revision).toBe(5);
  expect(changed.session.blocks.map((block) => block.id)).toEqual(["user"]);
  expect(changed.history?.before).toBe(1);
});
