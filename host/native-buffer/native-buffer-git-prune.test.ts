import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { createGitObjectStore, gitBlobOid } from "./git-object-store";
import { NATIVE_BUFFER_SWEEP_MANIFESTS, unreferencedSharedKeys } from "./native-buffer-git-prune";

const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const history = "native-activity/buffer-history";
const chunk = (digest: string) => `${history}/chunks/${digest}.bin`;
const manifest = (name: string) => `${history}/reports/${"a".repeat(64)}/${name}.json`;
const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function repository(files: Record<string, string>) {
  const root = await mkdtemp(join(tmpdir(), "nb-git-prune-"));
  roots.push(root);
  const git = createGitObjectStore({ git: "git", gitDir: join(root, "r.git"), timeoutMs: 30_000 });
  await git.exec(["init", "--bare", "--quiet", "--object-format=sha1"]);
  const bodies = Object.values(files).map((value) => Buffer.from(value));
  await git.writeBlobs(bodies);
  const tree = await git.buildTree(
    null,
    Object.keys(files).map((path, index) => ({ path, oid: gitBlobOid(bodies[index]) })),
  );
  return { git, tree };
}

it("keeps keys referenced by remaining base and batch manifests and drops the rest", async () => {
  const [a, b, c, d] = ["a", "b", "c", "d"].map(sha);
  const { git, tree } = await repository({
    [manifest("kept")]: JSON.stringify({ version: 1, chunks: [{ digest: a }] }),
    [manifest("dropped")]: JSON.stringify({ version: 1, chunks: [{ digest: b }] }),
    [chunk(a)]: "a",
    [chunk(b)]: "b",
    [chunk(c)]: "c",
    [`${history}/chunks/legacy-name.bin`]: "kept: not content-addressed",
  });
  const added = new Map([
    [manifest("new"), Buffer.from(JSON.stringify({ version: 2, body: { templateDigest: d } }))],
    [
      `${history}/templates/${d}.json`,
      Buffer.from(JSON.stringify({ version: 1, chunks: [{ digest: c }] })),
    ],
  ]);
  expect(await unreferencedSharedKeys(git, tree, added, new Set([manifest("dropped")]))).toEqual([
    chunk(b),
  ]);
});

it("skips the sweep for unreadable manifests, missing templates and the manifest cap", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const a = sha("a");
  const { git, tree } = await repository({
    [manifest("broken")]: "not json",
    [chunk(a)]: "a",
  });
  expect(await unreferencedSharedKeys(git, tree, new Map(), new Set())).toEqual([]);
  const missing = new Map([
    [manifest("v2"), Buffer.from(JSON.stringify({ version: 2, body: { templateDigest: a } }))],
  ]);
  expect(await unreferencedSharedKeys(git, tree, missing, new Set([manifest("broken")]))).toEqual(
    [],
  );
  const many = new Map(
    Array.from({ length: NATIVE_BUFFER_SWEEP_MANIFESTS + 1 }, (_, index) => [
      manifest(`m${index}`),
      Buffer.from(JSON.stringify({ version: 1, chunks: [] })),
    ]),
  );
  expect(await unreferencedSharedKeys(git, null, many, new Set())).toEqual([]);
  expect(warn).toHaveBeenCalled();
});
