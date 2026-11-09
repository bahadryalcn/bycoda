import { expect, it, vi } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HostCheckpoints } from "./checkpoints";

it("shares an in-flight archive validation and still detects a later legacy writer", async () => {
  const root = await mkdtemp(join(tmpdir(), "bycoda-checkpoint-index-"));
  const folder = join(root, "legacy");
  await mkdir(folder);
  const manifest = join(folder, "manifest.json");
  await writeFile(manifest, JSON.stringify({ cwd: "/repo", head: null, shared: false, files: {} }));
  const checkpoints = new HostCheckpoints(root);
  const target = checkpoints as unknown as {
    refreshActiveIndex: () => Promise<void>;
    load: (id: string) => Promise<unknown>;
    legacyActive: Map<string, string>;
  };
  const original = target.load.bind(checkpoints);
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const spy = vi.spyOn(target, "load").mockImplementation(async (id) => {
    await held;
    return original(id);
  });
  const first = target.refreshActiveIndex();
  try {
    await vi.waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    const second = target.refreshActiveIndex();
    release();
    await Promise.all([first, second]);
    expect(spy).toHaveBeenCalledTimes(1);
    await writeFile(
      manifest,
      JSON.stringify({ cwd: "/repo", head: null, shared: false, files: {}, active: { dirty: {} } }),
    );
    await target.refreshActiveIndex();
    expect(spy).toHaveBeenCalledTimes(2);
    expect(target.legacyActive.get("legacy")).toBe("/repo");
  } finally {
    release();
    await first;
    spy.mockRestore();
    await rm(root, { recursive: true, force: true });
  }
});
