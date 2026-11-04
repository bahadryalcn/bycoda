import { describe, expect, it, vi } from "vitest";
import {
  createSessionReadService,
  type ReadSync,
  type SessionReadPorts,
  type SessionDomainContext,
} from "./service";

type Block = { id: string; role: string; text: string; approval?: { decided?: boolean } };
type View = {
  revision: number;
  status: "idle" | "running" | "interrupted";
  session: { title: string; blocks: Block[]; extension: string };
  secretExtension: string;
};
type Delta = {
  revision: number;
  status: "idle" | "running" | "interrupted";
  session: { title: string };
  head?: { count: number; chain: string };
};
type Sync = ReadSync<View, Delta, Block>;
const context = (): SessionDomainContext => ({ authorized: vi.fn(async () => true) });
function setup() {
  const value: View = {
    revision: 8,
    status: "running",
    session: {
      title: "full",
      blocks: [
        { id: "u", role: "user", text: "user" },
        { id: "a", role: "assistant", text: "answer" },
        { id: "s", role: "system", text: "system" },
        { id: "p", role: "assistant", text: "", approval: {} },
      ],
      extension: "keep",
    },
    secretExtension: "keep",
  };
  const sync: Sync = { kind: "snapshot", value };
  const ports: SessionReadPorts<View, Delta, { id: string }, Sync> = {
    repository: {
      projectList: vi.fn(async () => ({ list: [{ id: "session" }], etag: "etag" })),
      session: vi.fn(async () => value),
      sync: vi.fn(async () => sync),
      readView: vi.fn(async () => value),
      catchUp: vi.fn(async () => {}),
    },
    nativeProjection: {
      watch: vi.fn(async () => undefined),
      view: vi.fn(async () => undefined),
      sync: vi.fn(() => sync),
      recheckMs: vi.fn(async () => 1000),
    },
    transcript: {
      page: vi.fn(async (load) => ({ value: await load(), revision: 8, totalBlocks: 4 })),
      preview: vi.fn((view) => view),
      summaryPage: vi.fn((view) => ({ value: view, revision: 8, totalBlocks: 4 })),
      partial: vi.fn(() => undefined),
      withHead: vi.fn(() => ({ head: { count: 4, chain: "hash" } })),
      previewRewindHistory: vi.fn(() => ({})),
    },
    transfers: { respond: vi.fn((_id, value) => value), chunk: vi.fn(() => ({ data: "piece" })) },
    revisionWaits: { wait: vi.fn(async () => {}) },
  };
  return { value, ports, service: createSessionReadService(ports), auth: context() };
}

describe("session read domain", () => {
  it("keeps legacy list/etag negotiation and complete metadata", async () => {
    const { service, auth } = setup();
    expect(await service.list({ projectId: "p" }, auth)).toEqual([{ id: "session" }]);
    expect(await service.list({ projectId: "p", known: "etag" }, auth)).toEqual({
      unchanged: true,
      etag: "etag",
    });
    expect(await service.list({ projectId: "p", known: "old" }, auth)).toEqual({
      etag: "etag",
      sessions: [{ id: "session" }],
    });
  });
  it("does not expose a read completed after authorization was revoked", async () => {
    const { service, ports, auth } = setup();
    vi.mocked(ports.repository.projectList).mockImplementation(async () => {
      auth.authorized = async () => false;
      return { list: [{ id: "secret" }], etag: "e" };
    });
    await expect(service.list({ projectId: "p" }, auth)).rejects.toThrow("revoked");
  });
  it("never loads data for an already cancelled request", async () => {
    const { service, ports, auth } = setup();
    const abort = new AbortController();
    abort.abort();
    await expect(
      service.get({ sessionId: "s" }, { ...auth, signal: abort.signal }),
    ).rejects.toThrow("cancelled");
    expect(ports.repository.readView).not.toHaveBeenCalled();
  });
  it("pages the desktop projection and preserves executor identity and extension fields", async () => {
    const { service, ports, value, auth } = setup();
    vi.mocked(ports.nativeProjection.watch).mockResolvedValue({ projectId: "p", revision: 8 });
    vi.mocked(ports.nativeProjection.view).mockResolvedValue(value);
    const result = await service.page(
      { sessionId: "s", before: 2, revision: 8, preview: true, digests: true },
      auth,
    );
    expect(ports.transcript.page).toHaveBeenCalledWith(expect.any(Function), "s", 2, 8, true, true);
    expect(result).toMatchObject({
      sync: {
        kind: "snapshot",
        value: {
          executionOwner: "desktop",
          secretExtension: "keep",
          session: { extension: "keep" },
        },
      },
    });
    expect(result).not.toHaveProperty("value");
    expect(ports.repository.session).not.toHaveBeenCalled();
  });
  it("checks authorization again when a revision wait ends", async () => {
    const { service, ports, auth } = setup();
    vi.mocked(ports.revisionWaits.wait).mockImplementation(async (_read, _rev, _ms, cancelled) => {
      auth.authorized = async () => false;
      expect(await cancelled()).toBe(true);
    });
    await expect(service.sync({ sessionId: "s", revision: 8, waitMs: 500 }, auth)).rejects.toThrow(
      "revoked",
    );
    expect(ports.repository.catchUp).not.toHaveBeenCalled();
  });
  it("propagates request cancellation to the revision waiter", async () => {
    const { service, ports, auth } = setup();
    const abort = new AbortController();
    vi.mocked(ports.revisionWaits.wait).mockImplementation(async (_read, _rev, _ms, cancelled) => {
      abort.abort();
      expect(await cancelled()).toBe(true);
    });
    await expect(
      service.sync({ sessionId: "s", revision: 8, waitMs: 500 }, { ...auth, signal: abort.signal }),
    ).rejects.toThrow("cancelled");
  });
  it("skips transcript IO for an unchanged desktop revision", async () => {
    const { service, ports, auth } = setup();
    vi.mocked(ports.nativeProjection.watch).mockResolvedValue({ projectId: "p", revision: 8 });
    expect(await service.sync({ sessionId: "s", revision: 8 }, auth)).toEqual({
      kind: "unchanged",
      revision: 8,
    });
    expect(ports.nativeProjection.view).not.toHaveBeenCalled();
    expect(ports.repository.catchUp).not.toHaveBeenCalled();
  });
  it("catches up when a desktop projection disappears and retains its current owner projection", async () => {
    const { service, ports, auth } = setup();
    vi.mocked(ports.nativeProjection.watch).mockResolvedValue({ projectId: "p", revision: 9 });
    const result = await service.sync({ sessionId: "s", revision: 7 }, auth);
    expect(ports.repository.catchUp).toHaveBeenCalledWith("s");
    // A surviving desktop watch remains the owner projection, matching legacy behavior.
    expect(result).toMatchObject({ kind: "snapshot", value: { executionOwner: "desktop" } });
  });
  it("falls back to a bounded snapshot when partial sync cannot be formed", async () => {
    const { service, ports, auth } = setup();
    await service.sync(
      { sessionId: "s", revision: 7, partial: true, loadedBlockIds: ["u"], digests: true },
      auth,
    );
    expect(ports.transcript.partial).toHaveBeenCalledWith(
      expect.any(Object),
      expect.any(Object),
      ["u"],
      true,
    );
    expect(ports.transcript.page).toHaveBeenCalledWith(
      expect.any(Function),
      "s",
      undefined,
      undefined,
      true,
      true,
    );
    expect(ports.transcript.preview).toHaveBeenCalledWith(expect.any(Object), true);
  });
  it.each([
    { label: "empty ID", ids: [""] },
    { label: "oversize ID", ids: ["x".repeat(513)] },
    { label: "non-string ID", ids: [42] },
    { label: "too many IDs", ids: Array(32769).fill("x") },
  ])("rejects invalid loaded IDs: $label", async ({ ids }) => {
    const { service, auth } = setup();
    await expect(
      service.sync({ sessionId: "s", partial: true, loadedBlockIds: ids }, auth),
    ).rejects.toThrow("Invalid loaded block IDs");
  });
  it("adds the full transcript head and rewind preview to a delta", async () => {
    const { service, ports, auth } = setup();
    vi.mocked(ports.repository.sync).mockResolvedValue({
      kind: "delta",
      base: 7,
      value: { revision: 8, status: "running", session: { title: "new" } },
      blockIds: [],
      blocks: [],
    });
    expect(await service.sync({ sessionId: "s", revision: 7, digests: true }, auth)).toMatchObject({
      kind: "delta",
      value: { executionOwner: "host", head: { count: 4, chain: "hash" } },
    });
    expect(ports.transcript.previewRewindHistory).toHaveBeenCalledWith({ title: "new" });
  });
  it("keeps legacy get revision and assistant/system/approval summary behavior", async () => {
    const { service, ports, auth } = setup();
    expect(await service.get({ sessionId: "s", revision: 8 }, auth)).toBeNull();
    const result = await service.get({ sessionId: "s", preview: true, summary: true }, auth);
    expect(result?.session.blocks.map((block) => block.id)).toEqual(["a", "s", "p"]);
    expect(ports.transcript.summaryPage).toHaveBeenCalledOnce();
  });
  it("pins full block reads to their revision and retains history size", async () => {
    const { service, auth } = setup();
    await expect(
      service.block({ sessionId: "s", blockId: "a", revision: 7 }, auth),
    ).rejects.toThrow("Transcript changed");
    await expect(
      service.block({ sessionId: "s", blockId: "missing", revision: 8 }, auth),
    ).rejects.toThrow("no longer exists");
    expect(await service.block({ sessionId: "s", blockId: "a", revision: 8 }, auth)).toMatchObject({
      kind: "snapshot",
      value: { session: { blocks: [{ id: "a" }] }, history: { revision: 8, totalBlocks: 4 } },
    });
  });
  it("uses a transfer's pinned slice and propagates repository failures", async () => {
    const { service, ports, auth } = setup();
    expect(await service.syncChunk({ sessionId: "s", transfer: "t", offset: 4 }, auth)).toEqual({
      data: "piece",
    });
    expect(ports.transfers.chunk).toHaveBeenCalledWith("s", "t", 4);
    vi.mocked(ports.repository.readView).mockRejectedValue(new Error("unavailable"));
    await expect(service.get({ sessionId: "s" }, auth)).rejects.toThrow("unavailable");
  });
});


it("forwards original read cancellation through full stream ports and stops after accepted catch-up settles", async () => {
  const f = setup();
  const controller = new AbortController();
  vi.mocked(f.ports.nativeProjection.watch).mockResolvedValue(undefined);
  vi.mocked(f.ports.repository.catchUp).mockImplementation(async () => { controller.abort(); });
  await expect(f.service.stream({ sessionId: "session" }, { ...f.auth, signal: controller.signal })).rejects.toThrow();
  expect(f.ports.nativeProjection.watch).toHaveBeenCalledWith("session", false, controller.signal);
  expect(f.ports.repository.catchUp).toHaveBeenCalledWith("session", controller.signal);
  expect(f.ports.repository.session).not.toHaveBeenCalled();
});
