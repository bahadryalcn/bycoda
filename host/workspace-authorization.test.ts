import { afterEach, expect, it } from "vitest";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { createHostPath, writeHostFile } from "./workspace";
import { withWorkspaceMutation } from "./workspace-mutations";

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0)) {
    const target = resolve(directory);
    if (
      dirname(target) !== resolve(tmpdir()) ||
      !basename(target).startsWith("bycoda-file-authority-")
    )
      throw new Error("Unexpected fixture cleanup path");
    await rm(target, { recursive: true, force: true });
  }
});
async function holdMutation() {
  const root = await mkdtemp(join(tmpdir(), "bycoda-file-authority-"));
  directories.push(root);
  let release!: () => void;
  let started!: () => void;
  const entered = new Promise<void>((done) => {
    started = done;
  });
  const held = new Promise<void>((done) => {
    release = done;
  });
  const previous = withWorkspaceMutation(root, async () => {
    started();
    await held;
  });
  await entered;
  return { root, previous, release };
}
it("rechecks file write authority after waiting behind another workspace mutation", async () => {
  const f = await holdMutation();
  await writeFile(join(f.root, "note.txt"), "before");
  let authorized = true;
  const queued = writeHostFile(f.root, "note.txt", "before", "after", async () => authorized);
  const rejected = expect(queued).rejects.toThrow("authorization was revoked");
  authorized = false;
  f.release();
  await f.previous;
  await rejected;
  expect(await readFile(join(f.root, "note.txt"), "utf8")).toBe("before");
});
it("does not create intermediate folders after queued creation loses its grant", async () => {
  const f = await holdMutation();
  let authorized = true;
  const queued = createHostPath(f.root, "", "new/nested/note.txt", false, async () => authorized);
  const rejected = expect(queued).rejects.toThrow("authorization was revoked");
  authorized = false;
  f.release();
  await f.previous;
  await rejected;
  await expect(stat(join(f.root, "new"))).rejects.toMatchObject({ code: "ENOENT" });
});
