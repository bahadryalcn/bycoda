import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { BYKIT_PIN, bykitAsset, readBykitArchive } from "./bykit.mjs";

const bytes = Buffer.from("archive");
const pin = (sha256) => ({
  version: "9.9.9",
  repository: "https://example.invalid/bykit",
  targets: { "linux-x64": { triple: "x86_64-unknown-linux-gnu", sha256 } },
});
async function cache(t) {
  const path = await mkdtemp(join(tmpdir(), "bycoda-bykit-"));
  t.after(() => rm(path, { recursive: true, force: true }));
  return path;
}
const serve = (body) => async () => new Response(body);

test("the shipped pin names the four release targets", () => {
  assert.equal(
    bykitAsset("win32-x64").name,
    `bykit-v${BYKIT_PIN.version}-x86_64-pc-windows-msvc.zip`,
  );
  assert.equal(bykitAsset("darwin-arm64").name.endsWith("aarch64-apple-darwin.tar.gz"), true);
  assert.throws(() => bykitAsset("linux-arm64"), /no release/);
});

test("a placeholder checksum fails packaging before any download", async (t) => {
  let called = false;
  await assert.rejects(
    readBykitArchive({
      target: "linux-x64",
      cacheRoot: await cache(t),
      pin: pin("REPLACE_ME"),
      fetcher: async () => ((called = true), new Response(bytes)),
    }),
    /placeholder/,
  );
  assert.equal(called, false);
});

test("a checksum mismatch is rejected and nothing is cached", async (t) => {
  const root = await cache(t);
  const options = { target: "linux-x64", cacheRoot: root, pin: pin("a".repeat(64)) };
  await assert.rejects(
    readBykitArchive({ ...options, fetcher: serve(bytes) }),
    /checksum mismatch/,
  );
  await assert.rejects(
    readBykitArchive({ ...options, fetcher: serve(bytes) }),
    /checksum mismatch/,
  );
});

test("a matching download is cached and reused", async (t) => {
  const root = await cache(t);
  const sha = createHash("sha256").update(bytes).digest("hex");
  const options = { target: "linux-x64", cacheRoot: root, pin: pin(sha) };
  const first = await readBykitArchive({ ...options, fetcher: serve(bytes) });
  assert.equal(first.name, "bykit-v9.9.9-x86_64-unknown-linux-gnu.tar.gz");
  const second = await readBykitArchive({
    ...options,
    fetcher: async () => assert.fail("reuses the cached archive"),
  });
  assert.equal(second.path, first.path);
});
