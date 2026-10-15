import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GenericAcpService } from "./generic-acp";
describe("host-owned ACP configuration", () => {
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
