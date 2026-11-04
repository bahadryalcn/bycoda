import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as fs from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readStateFile, readStateFileSync, writeFileAtomic } from "./atomic-write";

vi.mock("node:fs/promises", async (original) => {
  const actual = await original<typeof import("node:fs/promises")>();
  return { ...actual, open: vi.fn(actual.open) };
});

it.each(["async", "sync"])("retries %s evidence retention after a partial copy", async (kind) => {
  const target = join(directory, "state.json");
  await fs.writeFile(target, "corrupt original");
  const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
  vi.mocked(fs.open).mockImplementationOnce(async (...args) => {
    const handle = await actual.open(...args);
    vi.spyOn(handle, "writeFile").mockImplementationOnce(async () => {
      await handle.write("partial");
      throw new Error("injected partial evidence copy");
    });
    return handle;
  });
  const failed = await readStateFile(target, JSON.parse);
  expect(failed.status).toBe("corrupt");
  if (failed.status !== "corrupt") throw new Error("Expected corrupt state");
  expect(failed.quarantined).toBeUndefined();
  const retried =
    kind === "async"
      ? await readStateFile(target, JSON.parse)
      : readStateFileSync(target, JSON.parse);
  if (retried.status !== "corrupt" || !retried.quarantined)
    throw new Error("Evidence retry failed");
  expect(await fs.readFile(retried.quarantined, "utf8")).toBe("corrupt original");
  expect(await fs.readFile(target, "utf8")).toBe("corrupt original");
});

let directory: string;
beforeEach(async () => {
  directory = await fs.mkdtemp(join(tmpdir(), "bycoda-atomic-fault-"));
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.mocked(fs.open).mockReset();
  vi.mocked(fs.open).mockImplementation(
    (await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises")).open,
  );
  await fs.rm(directory, { recursive: true, force: true });
});

it.each(["writeFile", "sync"] as const)(
  "retains prior state when staged %s fails",
  async (method) => {
    const target = join(directory, "state.json");
    await fs.writeFile(target, "prior state");
    const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    vi.mocked(fs.open).mockImplementationOnce(async (...args) => {
      const handle = await actual.open(...args);
      vi.spyOn(handle, method).mockRejectedValueOnce(new Error("injected storage failure"));
      return handle;
    });
    await expect(writeFileAtomic(target, "new state")).rejects.toThrow("injected storage failure");
    expect(await fs.readFile(target, "utf8")).toBe("prior state");
    expect(await fs.readdir(directory)).toEqual(["state.json"]);
  },
);
