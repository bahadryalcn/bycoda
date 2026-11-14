import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  CUA_DRIVER_FILES,
  CUA_DRIVER_SOURCE,
  copyCuaDriverBundle,
  cuaDriverPlan,
  prepareCuaDriver,
  readCuaDriver,
} from "./cua-driver.mjs";

const license = await readFile(new URL("../../vendor/cua-driver/LICENSE", import.meta.url));
const scope = { platform: "win32", arch: "x64" };
async function directory(t) {
  const path = await mkdtemp(join(tmpdir(), "bycoda-cua-driver-"));
  t.after(() => rm(path, { recursive: true, force: true }));
  return path;
}
/** Writes the archive's folder the way the pinned zip extracts. */
const fakeExtract =
  (overrides = {}) =>
  async (_archive, directory) => {
    const root = join(directory, cuaDriverPlan(scope).folder);
    await mkdir(root, { recursive: true });
    for (const name of [...CUA_DRIVER_FILES, "cua_driver_sdk.dll"])
      await writeFile(join(root, name), name === "LICENSE" ? license : `fixture ${name}`);
    for (const [name, value] of Object.entries(overrides)) await writeFile(join(root, name), value);
  };

test("vendor provenance matches the embedded pin", async () => {
  const vendored = JSON.parse(
    await readFile(new URL("../../vendor/cua-driver/source.json", import.meta.url), "utf8"),
  );
  assert.deepEqual(vendored, { ...CUA_DRIVER_SOURCE });
});

test("plans the pinned release asset and refuses other platforms", () => {
  const plan = cuaDriverPlan({ ...scope, cacheRoot: "C:\\cache" });
  assert.equal(
    plan.url,
    "https://github.com/trycua/cua/releases/download/cua-driver-rs-v0.49.11/cua-driver-rs-0.49.11-windows-x86_64.zip",
  );
  assert.match(plan.sha256, /^[a-f0-9]{64}$/);
  assert.throws(() => cuaDriverPlan({ platform: "linux", arch: "x64" }), /Windows only/);
});

test("prepares only the CLI files, verifies them and detects tampering", async (t) => {
  const cacheRoot = await directory(t);
  const downloads = [];
  const helper = await prepareCuaDriver(
    { ...scope, cacheRoot },
    {
      download: async (url, path, sha256) => {
        downloads.push({ url, sha256 });
        await writeFile(path, "archive");
      },
      extract: fakeExtract(),
    },
  );
  assert.equal(downloads.length, 1);
  assert.equal(helper.version, CUA_DRIVER_SOURCE.version);
  assert.ok(helper.binaryPath.endsWith("cua-driver.exe"));
  assert.deepEqual(helper.files.map((file) => file.name).sort(), [...CUA_DRIVER_FILES].sort());
  assert.ok((await readCuaDriver({ ...scope, cacheRoot }))?.binarySha256);
  // A second prepare reuses the verified bundle.
  await prepareCuaDriver(
    { ...scope, cacheRoot },
    { download: () => assert.fail("downloaded twice") },
  );
  const copy = await copyCuaDriverBundle(
    join(helper.manifestPath, ".."),
    join(cacheRoot, "pkg"),
    scope,
  );
  assert.deepEqual(copy.manifest, helper.manifest);
  await writeFile(helper.binaryPath, "tampered");
  await assert.rejects(readCuaDriver({ ...scope, cacheRoot }), /changed/);
});

test("rejects a release whose license differs from the pin", async (t) => {
  const cacheRoot = await directory(t);
  await assert.rejects(
    prepareCuaDriver(
      { ...scope, cacheRoot },
      {
        download: async (_url, path) => writeFile(path, "archive"),
        extract: fakeExtract({ LICENSE: "not MIT" }),
      },
    ),
    /license changed/,
  );
  assert.equal(await readCuaDriver({ ...scope, cacheRoot }), undefined);
});
