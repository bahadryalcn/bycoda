import { mkdtemp, mkdir, readFile, realpath, rm, writeFile, access } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, it, vi } from "vitest";
import { CheckpointLeases } from "./checkpoint-leases";

const hook = vi.hoisted(() => ({
  afterRead: undefined as ((path: unknown) => Promise<void>) | undefined,
}));
vi.mock("node:fs/promises", async (original) => {
  const fs = await original<typeof import("node:fs/promises")>();
  return {
    ...fs,
    readFile: async (...args: Parameters<typeof fs.readFile>) => {
      const bytes = await fs.readFile(...args);
      await hook.afterRead?.(args[0]);
      return bytes;
    },
  };
});
const roots: string[] = [];
afterEach(async () => {
  hook.afterRead = undefined;
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

it("does not resurrect a native lease released after the host read its overlap snapshot", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "bycoda-lease-race-")));
  roots.push(root);
  const cwd = join(root, "project-ğ");
  await mkdir(cwd);
  const native = join(root, "native-peer-turn.json");
  await writeFile(
    native,
    JSON.stringify({ owner: "native", sessionId: "peer", turnId: "turn", cwd, shared: false }),
  );
  let nativeReads = 0;
  hook.afterRead = async (path) => {
    if (path === native && ++nativeReads === 2) {
      hook.afterRead = undefined;
      await rm(native);
    }
  };
  const leases = new CheckpointLeases(root);
  expect(await leases.publish("host", "turn", cwd)).toBe(true);
  await expect(access(native)).rejects.toMatchObject({ code: "ENOENT" });
  await leases.release("host", "turn");
  expect(await leases.active(cwd)).toBe(false);
});

it("marks a live peer without replacing its file or changing its UTF-8 metadata", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "bycoda-lease-live-")));
  roots.push(root);
  const cwd = join(root, "project-ğ");
  await mkdir(cwd);
  const native = join(root, "native-peer-turn.json");
  const lease = { owner: "native", sessionId: "peer", turnId: "turn", cwd, shared: false };
  await writeFile(native, JSON.stringify(lease));
  const leases = new CheckpointLeases(root);
  expect(await leases.publish("host", "turn", cwd)).toBe(true);
  expect(JSON.parse(await readFile(native, "utf8"))).toEqual({ ...lease, shared: true });
  expect(await leases.active(cwd)).toBe(true);
});
