import { describe, expect, it, vi } from "vitest";
import { createFileService, type FileServicePorts } from "./service";

function fixture() {
  let permitted = true;
  const release = vi.fn(async () => {});
  const ports: FileServicePorts = {
    project: vi.fn(async () => ({ cwd: "project" })),
    resolveWorkspace: vi.fn(async () => "verified-workspace"),
    activity: vi.fn(async () => release),
    files: {
      read: vi.fn(async () => "content"),
      list: vi.fn(async () => []),
      index: vi.fn(async () => []),
      search: vi.fn(async () => []),
      searchContent: vi.fn(async () => ({ matches: [], truncated: false })),
      create: vi.fn(async () => "created"),
      write: vi.fn(async () => {}),
    },
  };
  return {
    ports,
    service: createFileService(ports),
    context: { authorized: async () => permitted },
    revoke: () => {
      permitted = false;
    },
    release,
  };
}
describe("file service admission", () => {
  it("does not disclose a read completed after its grant was revoked", async () => {
    const f = fixture();
    vi.mocked(f.ports.files.read).mockImplementation(async () => {
      f.revoke();
      return "private";
    });
    await expect(f.service.read({ projectId: "p", path: "a" }, f.context)).rejects.toThrow(
      "revoked",
    );
  });
  it("releases editor activity when revocation arrives during acquisition", async () => {
    const f = fixture();
    vi.mocked(f.ports.activity).mockImplementation(async () => {
      f.revoke();
      return f.release;
    });
    await expect(
      f.service.write({ projectId: "p", path: "a", expected: "", content: "new" }, f.context),
    ).rejects.toThrow("revoked");
    expect(f.ports.files.write).not.toHaveBeenCalled();
    expect(f.release).toHaveBeenCalledOnce();
  });
  it("passes a live grant to the serialized mutation owner and releases failures", async () => {
    const f = fixture();
    vi.mocked(f.ports.files.write).mockImplementation(
      async (_cwd, _path, _before, _after, authorized) => {
        expect(await authorized()).toBe(true);
        f.revoke();
        expect(await authorized()).toBe(false);
        throw new Error("owner denied queued write");
      },
    );
    await expect(
      f.service.write({ projectId: "p", path: "a", expected: "", content: "new" }, f.context),
    ).rejects.toThrow("owner denied");
    expect(f.release).toHaveBeenCalledOnce();
  });
  it("rejects canonical extension fields before I/O while retaining HTTP compatibility", async () => {
    const f = fixture();
    const params = { projectId: "p", path: "a", oldClientFlag: true };
    await expect(f.service.read(params, f.context)).rejects.toThrow();
    expect(f.ports.project).not.toHaveBeenCalled();
    await expect(f.service.read(params, f.context, { legacy: true })).resolves.toBe("content");
  });
  it("passes cancellable search work to its owner and rejects a late cancelled result", async () => {
    const f = fixture();
    const controller = new AbortController();
    vi.mocked(f.ports.files.searchContent).mockImplementation(async (_cwd, _params, signal) => {
      expect(signal).toBe(controller.signal);
      controller.abort();
      return { matches: [], truncated: false };
    });
    await expect(
      f.service.searchContent(
        { projectId: "p", query: "text" },
        {
          ...f.context,
          signal: controller.signal,
        },
      ),
    ).rejects.toThrow("cancelled");
  });
});
