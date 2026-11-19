import { describe, expect, it, vi } from "vitest";
import type { ModelRoutingState } from "../../../shared/model/host-contracts/model-routing";
import { syncProjectKindsWith, type ProjectKindsIo } from "./projectKindsSync";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("../../automations/public/hostMachines", () => ({
  machineCapabilities: vi.fn(),
}));
vi.mock("../../connections/public/connections", () => ({
  remoteRequest: vi.fn(),
}));
vi.mock("../../connections/public/localSync", () => ({
  isLocalSyncMachine: vi.fn(),
}));

const state = (
  version: number,
  projectKinds?: ModelRoutingState["projectKinds"],
): ModelRoutingState => ({
  version,
  updatedAt: 1,
  entries: [],
  pools: [],
  roles: {},
  delegation: { global: {}, providers: {}, accounts: {} },
  ...(projectKinds ? { projectKinds } : {}),
});

function fake(overrides: Partial<ProjectKindsIo> = {}) {
  const io = {
    supported: vi.fn(async () => true),
    get: vi.fn(async () => state(3)),
    save: vi.fn(
      async (version: number, draft: object) =>
        ({ ...state(version + 1), ...draft }) as ModelRoutingState,
    ),
  };
  // Overrides replace mocks with the same signature; keep the mock types for call assertions.
  return { ...io, ...overrides } as typeof io;
}

describe("syncProjectKindsWith", () => {
  it("does nothing, and reports success, when the Host already holds the same map", async () => {
    const io = fake({ get: vi.fn(async () => state(3, { "g:/a": "work" })) });
    await expect(syncProjectKindsWith(io, { "g:/a": "work" })).resolves.toBe(true);
    expect(io.save).not.toHaveBeenCalled();
  });

  it("reports a failed send as false so the caller can retry", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const unsupported = fake({ supported: vi.fn(async () => false) });
    await expect(syncProjectKindsWith(unsupported, { "g:/a": "work" })).resolves.toBe(false);
    const offline = fake({ get: vi.fn(async () => Promise.reject(new Error("offline"))) });
    await expect(syncProjectKindsWith(offline, { "g:/a": "work" })).resolves.toBe(false);
    const conflicted = fake({ save: vi.fn(async () => Promise.reject(new Error("conflict"))) });
    await expect(syncProjectKindsWith(conflicted, { "g:/a": "work" })).resolves.toBe(false);
    await expect(syncProjectKindsWith(fake(), { "g:/a": "work" })).resolves.toBe(true);
  });

  it("saves only projectKinds against the read version", async () => {
    const io = fake();
    const onSaved = vi.fn();
    await syncProjectKindsWith(io, { "g:/a": "work" }, onSaved);
    expect(io.save).toHaveBeenCalledWith(
      3,
      expect.objectContaining({
        projectKinds: { "g:/a": "work" },
        entries: [],
      }),
    );
    expect(io.save.mock.calls[0][1]).not.toHaveProperty("version");
    expect(onSaved).toHaveBeenCalledOnce();
  });

  it("omits the field for an empty map", async () => {
    const io = fake({ get: vi.fn(async () => state(3, { "g:/a": "work" })) });
    await syncProjectKindsWith(io, {});

    expect(io.save.mock.calls[0][1]).not.toHaveProperty("projectKinds");
  });

  it("re-reads and retries once on a conflict, then gives up quietly", async () => {
    vi.spyOn(console, "warn");
    let reads = 0;
    const io = fake({
      get: vi.fn(async () => state(++reads)),
      save: vi.fn(async () => {
        throw new Error("conflict");
      }),
    });
    await expect(syncProjectKindsWith(io, { "g:/a": "work" })).resolves.toBeUndefined();
    expect(io.get).toHaveBeenCalledTimes(2);
    expect(io.save).toHaveBeenCalledTimes(2);
    expect(io.save.mock.calls[1][0]).toBe(2);
  });

  it("succeeds on the retry", async () => {
    const save = vi
      .fn()
      .mockRejectedValueOnce(new Error("conflict"))
      .mockResolvedValueOnce(state(5));
    const io = fake({ save });
    await syncProjectKindsWith(io, { "g:/a": "work" });
    expect(save).toHaveBeenCalledTimes(2);
  });

  it("skips an unsupported Host and swallows a failed read", async () => {
    vi.spyOn(console, "warn");
    const old = fake({ supported: vi.fn(async () => false) });
    await syncProjectKindsWith(old, { "g:/a": "work" });
    expect(old.get).not.toHaveBeenCalled();
    const broken = fake({
      get: vi.fn(async () => Promise.reject(new Error("offline"))),
    });
    await expect(syncProjectKindsWith(broken, { "g:/a": "work" })).resolves.toBeUndefined();
    expect(broken.save).not.toHaveBeenCalled();
  });
});
