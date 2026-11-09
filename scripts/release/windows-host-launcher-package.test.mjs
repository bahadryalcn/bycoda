import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const packageScript = fileURLToPath(new URL("../../host/package.mjs", import.meta.url));
test(
  "first local Windows package creates launcher staging before separation and reaches the bounded builder",
  { skip: process.platform !== "win32" },
  async (t) => {
    const root = await mkdtemp(join(tmpdir(), "bycoda-first-launcher-package-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    await writeFile(join(root, "package.json"), JSON.stringify({ version: "0.0.1" }));
    const output = join(root, "build/host-packages/win32-x64");
    await mkdir(output, { recursive: true });
    const sentinel = join(output, "previous.txt");
    await writeFile(sentinel, "usable previous package");
    const environment = Object.fromEntries(
      Object.entries(process.env).filter(([key]) => key.toUpperCase() !== "PATH"),
    );
    assert.throws(
      () =>
        execFileSync(
          process.execPath,
          [packageScript, "--target", "win32-x64", "--directory-only"],
          {
            cwd: root,
            encoding: "utf8",
            windowsHide: true,
            timeout: 10_000,
            stdio: ["ignore", "pipe", "pipe"],
            // Missing Cargo stops the real builder before compiler work or downloads.
            env: {
              ...environment,
              PATH: join(root, "no-toolchain"),
              BYCODA_BUILD_MANIFEST: "",
              BYCODA_HOST_RUNTIME_CACHE: join(root, "runtime-cache"),
            },
          },
        ),
      (error) => error.status === 1 && /spawnSync cargo ENOENT/.test(error.stderr),
    );
    assert.deepEqual(await readdir(join(root, "build/host-launcher")), []);
    assert.deepEqual(await readdir(join(root, "runtime-cache")), []);
    assert.equal(await readFile(sentinel, "utf8"), "usable previous package");
  },
);
test("missing or overlapping prebuilt Windows launcher cannot download or replace an existing package", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "bycoda-launcher-package-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, "package.json"), JSON.stringify({ version: "0.0.1" }));
  const output = join(root, "build/host-packages/win32-x64");
  await mkdir(output, { recursive: true });
  const sentinel = join(output, "previous.txt");
  await writeFile(sentinel, "usable previous package");
  const cache = join(root, "runtime-cache");
  for (const [directory, expected] of [
    [join(root, "missing-launchers"), /ENOENT/],
    [join(root, "build/host-packages"), /overlap/],
  ]) {
    assert.throws(
      () =>
        execFileSync(
          process.execPath,
          [
            packageScript,
            "--target",
            "win32-x64",
            "--directory-only",
            "--host-launcher-dir",
            directory,
          ],
          {
            cwd: root,
            encoding: "utf8",
            windowsHide: true,
            timeout: 10_000,
            stdio: ["ignore", "pipe", "pipe"],
            env: { ...process.env, BYCODA_BUILD_MANIFEST: "", BYCODA_HOST_RUNTIME_CACHE: cache },
          },
        ),
      (error) => error.status === 1 && expected.test(error.stderr),
    );
    assert.equal(await readFile(sentinel, "utf8"), "usable previous package");
    assert.deepEqual(await readdir(cache), []);
  }
});
