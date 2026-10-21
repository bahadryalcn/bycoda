import { describe, expect, it, vi } from "vitest";
import { execFile } from "node:child_process";
vi.mock("node:child_process", () => ({ execFile: vi.fn() }));
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GenericAcpService } from "./generic-acp";
describe("host-owned ACP configuration", () => {
  it("cancels during registry preparation before starting an installation", async () => {
    const service = new GenericAcpService("unused-cancelled-acp-directory");
    let finish!: (entries: Awaited<ReturnType<typeof service.registry>>) => void;
    const registry = vi.spyOn(service, "registry").mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const installing = service.install("one", "1.0.0");
    await expect(service.install("one", "1.0.0")).rejects.toThrow("already running");
    service.cancelInstall("one");
    expect(registry.mock.calls[0]?.[1]?.aborted).toBe(true);
    finish([
      {
        id: "one",
        name: "One",
        version: "1.0.0",
        description: "",
        package: "test-agent@1.0.0",
        args: [],
        supported: true,
      },
    ]);
    await expect(installing).rejects.toThrow(/abort/i);
    expect(execFile).not.toHaveBeenCalled();
    registry.mockResolvedValueOnce([]);
    await expect(service.install("one", "1.0.0")).rejects.toThrow("Pinned npm distribution");
  });
  it("preserves secret environment on edit, redacts lists and serializes concurrent saves", async () => {
    const directory = await mkdtemp(join(tmpdir(), "bycoda-acp-test-"));
    try {
      const service = new GenericAcpService(directory);
      await service.save({
        id: "one",
        name: "One",
        command: "node",
        args: [],
        env: { API_KEY: "test-secret" },
      });
      await Promise.all([
        service.save({ id: "one", name: "Edited", command: "node", args: ["one.js"] }),
        service.save({ id: "two", name: "Two", command: "node", args: [] }),
      ]);
      const summaries = await service.list();
      expect(summaries).toHaveLength(2);
      expect(JSON.stringify(summaries)).not.toContain("test-secret");
      expect(summaries.find((config) => config.id === "one")?.envKeys).toEqual(["API_KEY"]);
      expect((await service.get("one")).env?.API_KEY).toBe("test-secret");
      await service.remove("one");
      await expect(service.get("one")).rejects.toThrow("not configured");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
