import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile, mkdir, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { build } from "esbuild";
import {
  AGENT_DESKTOP_SOURCE,
  desktopHelperPlan,
  readDesktopHelper,
  readDesktopHelperBundle,
  copyDesktopHelperBundle,
  prepareDesktopHelper,
  importDesktopHelper,
  runHelperProcess,
} from "./agent-desktop.mjs";
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const license = await readFile(new URL("../../vendor/agent-desktop/LICENSE", import.meta.url));
async function directory(t) {
  const path = await mkdtemp(join(tmpdir(), "bycoda-desktop-helper-"));
  t.after(() => rm(path, { recursive: true, force: true }));
  return path;
}
async function bundle(t, binary = Buffer.from("fixture native binary")) {
  const cacheRoot = await directory(t),
    plan = desktopHelperPlan({ cacheRoot });
  await mkdir(plan.bundleDir, { recursive: true });
  const files = [];
  for (const name of plan.files) {
    const bytes = name === "LICENSE" ? license : binary;
    await writeFile(join(plan.bundleDir, name), bytes);
    files.push({ name, size: bytes.length, sha256: hash(bytes) });
  }
  const manifest = {
    schema: 1,
    source: { ...AGENT_DESKTOP_SOURCE },
    platform: plan.platform,
    arch: plan.arch,
    target: plan.target,
    binary: plan.binary,
    toolchain: AGENT_DESKTOP_SOURCE.rustToolchain,
    compiler: "rustc 1.89.0 (fixture)",
    builtAt: new Date().toISOString(),
    files,
  };
  const write = () => writeFile(join(plan.bundleDir, "manifest.json"), JSON.stringify(manifest));
  await write();
  return { cacheRoot, plan, manifest, write };
}
test("ships only verified helper files, retains license/provenance and discovers without setup tools", async (t) => {
  const f = await bundle(t),
    root = await directory(t),
    destination = join(root, "agent-desktop");
  const copied = await copyDesktopHelperBundle(f.plan.bundleDir, destination);
  assert.deepEqual(copied.manifest, f.manifest);
  assert.equal((await readDesktopHelperBundle(destination)).binarySha256, copied.binarySha256);
  assert.equal(await readFile(join(destination, "LICENSE"), "utf8"), license.toString("utf8"));
  await assert.rejects(copyDesktopHelperBundle(f.plan.bundleDir, destination), { code: "EEXIST" });
  await writeFile(copied.binaryPath, "tampered package");
  await assert.rejects(readDesktopHelperBundle(destination), /checksum/);
});
test("a missing bundled helper stays optional and cross-target helper metadata is refused", async (t) => {
  const root = await directory(t);
  assert.equal(await readDesktopHelperBundle(join(root, "missing")), undefined);
  const f = await bundle(t);
  f.manifest.arch = f.manifest.arch === "x64" ? "arm64" : "x64";
  await f.write();
  await assert.rejects(
    copyDesktopHelperBundle(f.plan.bundleDir, join(root, "invalid")),
    /provenance/,
  );
  await assert.rejects(access(join(root, "invalid")), { code: "ENOENT" });
});
async function buildFixture(t, options = {}) {
  const cacheRoot = await directory(t),
    plan = desktopHelperPlan({ cacheRoot }),
    lock = Buffer.from("fixture pinned Cargo lock\n"),
    source = { ...AGENT_DESKTOP_SOURCE, cargoLockSha256: hash(lock) };
  const calls = [];
  const run = async (binary, args, settings) => {
    settings.signal?.throwIfAborted();
    calls.push({ binary, args, settings });
    if (binary === "git" && args.includes("checkout")) {
      await writeFile(join(settings.cwd, "Cargo.lock"), options.badLock ? "changed" : lock);
      await writeFile(join(settings.cwd, "LICENSE"), license);
      await writeFile(
        join(settings.cwd, "rust-toolchain.toml"),
        '[toolchain]\nchannel = "1.89.0"\n',
      );
    }
    if (binary === "git" && args[0] === "rev-parse")
      return { stdout: options.badCommit ? "wrong" : source.sourceRef, exitCode: 0 };
    if (binary === "cargo") {
      if (options.build) await options.build();
      await mkdir(join(settings.cwd, "target", plan.target, "release"), { recursive: true });
      for (const name of [plan.binary, ...plan.helpers])
        await writeFile(
          join(settings.cwd, "target", plan.target, "release", name),
          "compiled fixture executable",
        );
    }
    if (binary === "rustc") return { stdout: "rustc 1.89.0 (fixture)", exitCode: 0 };
    if (args[0] === "version")
      return {
        stdout: JSON.stringify({
          version: options.badProtocol ? "0" : "2.5",
          ok: true,
          command: "version",
          data: { version: "1.0.2" },
        }),
        exitCode: 0,
      };
    return { stdout: "", exitCode: 0 };
  };
  return { cacheRoot, plan, source, run, calls };
}

test("embedded source metadata stays identical to the vendored immutable pin", async () => {
  const spec = JSON.parse(
    await readFile(new URL("../../vendor/agent-desktop/source.json", import.meta.url), "utf8"),
  );
  assert.deepEqual(AGENT_DESKTOP_SOURCE, spec);
  assert.equal(hash(license), spec.licenseSha256);
  const contract = await readFile(
    new URL("../../src/shared/model/host-contracts/desktop-control.ts", import.meta.url),
    "utf8",
  );
  assert.ok(contract.includes(spec.sourceRef));
  assert.ok(contract.includes(`AGENT_DESKTOP_PROTOCOL = "${spec.protocol}"`));
});
test("planning is read-only and names the native companion helpers on every supported target", async (t) => {
  const root = join(await directory(t), "not-created");
  const plan = desktopHelperPlan({ cacheRoot: root });
  await assert.rejects(access(root), { code: "ENOENT" });
  assert.equal(plan.configurationChanged, false);
  assert.ok(
    desktopHelperPlan({ platform: "darwin", arch: "arm64" }).helpers.includes(
      "agent-desktop-macos-helper",
    ),
  );
  assert.ok(
    desktopHelperPlan({ platform: "linux", arch: "x64" }).helpers.includes(
      "agent-desktop-linux-clipboard-owner",
    ),
  );
  assert.deepEqual(desktopHelperPlan({ platform: "win32", arch: "arm64" }).helpers, []);
  assert.throws(() => desktopHelperPlan({ platform: "freebsd", arch: "x64" }), /supported/);
});
test("readonly discovery verifies all file hashes and refuses changed or incomplete prepared packages", async (t) => {
  const f = await bundle(t);
  const result = await readDesktopHelper({ cacheRoot: f.cacheRoot });
  assert.equal(result.binarySha256, hash(Buffer.from("fixture native binary")));
  assert.equal(result.sourceRef, AGENT_DESKTOP_SOURCE.sourceRef);
  await writeFile(result.binaryPath, "changed");
  await assert.rejects(readDesktopHelper({ cacheRoot: f.cacheRoot }), /checksum/);
  await rm(result.binaryPath);
  await assert.rejects(readDesktopHelper({ cacheRoot: f.cacheRoot }), { code: "ENOENT" });
  assert.equal(await readDesktopHelper({ cacheRoot: join(f.cacheRoot, "absent") }), undefined);
});
test("manifest traversal and substituted source/protocol provenance are refused", async (t) => {
  const f = await bundle(t);
  f.manifest.files[0].name = "../outside.exe";
  await f.write();
  await assert.rejects(readDesktopHelper({ cacheRoot: f.cacheRoot }), /file set/);
  f.manifest.files[0].name = f.plan.binary;
  f.manifest.source.protocol = "new-protocol";
  await f.write();
  await assert.rejects(readDesktopHelper({ cacheRoot: f.cacheRoot }), /provenance/);
});
test("an explicit build fetches only the exact commit, uses locked pinned Rust and publishes an immutable hashed manifest", async (t) => {
  const f = await buildFixture(t);
  const stages = [];
  const result = await prepareDesktopHelper(
    { cacheRoot: f.cacheRoot, onProgress: (event) => stages.push(event.stage) },
    { run: f.run, source: f.source },
  );
  assert.equal(result.sourceRef, AGENT_DESKTOP_SOURCE.sourceRef);
  assert.equal(result.manifest.source.cargoLockSha256, f.source.cargoLockSha256);
  assert.deepEqual(stages, ["acquiring", "building", "verifying", "ready"]);
  const fetch = f.calls.find((call) => call.args.includes("fetch"));
  assert.ok(fetch.args.includes(f.source.sourceRef));
  assert.ok(fetch.args.includes(f.source.repository));
  const cargo = f.calls.find((call) => call.binary === "cargo");
  assert.ok(cargo.args.includes("+1.89.0"));
  assert.ok(cargo.args.includes("--locked"));
  assert.ok(cargo.args.includes(f.plan.target));
  assert.deepEqual(
    f.calls.filter((call) => call.args[0] === "version").map((call) => call.args),
    [["version"]],
  );
  const count = f.calls.length;
  assert.equal(
    (await prepareDesktopHelper({ cacheRoot: f.cacheRoot }, { run: f.run, source: f.source }))
      .binarySha256,
    result.binarySha256,
  );
  assert.equal(f.calls.length, count);
});
test("changed commits, lockfiles and native protocols never publish a helper package", async (t) => {
  for (const [flags, error] of [
    [{ badCommit: true }, /immutable commit/],
    [{ badLock: true }, /Cargo.lock/],
    [{ badProtocol: true }, /incompatible/],
  ]) {
    const f = await buildFixture(t, flags);
    await assert.rejects(
      prepareDesktopHelper({ cacheRoot: f.cacheRoot }, { run: f.run, source: f.source }),
      error,
    );
    await assert.rejects(access(f.plan.bundleDir), { code: "ENOENT" });
  }
});
test("concurrent setup and cancellation do not race promotion or replay a second build", async (t) => {
  const entered = Promise.withResolvers(),
    release = Promise.withResolvers(),
    f = await buildFixture(t, {
      build: async () => {
        entered.resolve();
        await release.promise;
      },
    }),
    controller = new AbortController();
  const first = prepareDesktopHelper(
    { cacheRoot: f.cacheRoot, signal: controller.signal },
    { run: f.run, source: f.source },
  );
  await entered.promise;
  await assert.rejects(
    prepareDesktopHelper({ cacheRoot: f.cacheRoot }, { run: f.run, source: f.source }),
    /already running/,
  );
  controller.abort();
  release.resolve();
  await assert.rejects(first, /abort/i);
  await assert.rejects(access(f.plan.bundleDir), { code: "ENOENT" });
});
test("a shipped prepared bundle imports without Git/Rust and refuses replacement by a different build", async (t) => {
  const f = await bundle(t),
    cacheRoot = await directory(t);
  const result = await importDesktopHelper({ cacheRoot, bundleDir: f.plan.bundleDir });
  assert.equal(
    result.binarySha256,
    (await readDesktopHelper({ cacheRoot: f.cacheRoot })).binarySha256,
  );
  assert.equal(
    (await importDesktopHelper({ cacheRoot, bundleDir: f.plan.bundleDir })).binaryPath,
    result.binaryPath,
  );
  const another = await bundle(t, Buffer.from("another compiler build"));
  await assert.rejects(
    importDesktopHelper({ cacheRoot, bundleDir: another.plan.bundleDir }),
    /different helper build/,
  );
});
test("bundling the reusable module into the Host does not execute its setup CLI", async (t) => {
  const root = await directory(t),
    outfile = join(root, "bycoda-host.mjs");
  await build({
    stdin: {
      contents:
        'import { desktopHelperPlan } from "./scripts/setup/agent-desktop.mjs"; console.log(desktopHelperPlan().source.protocol);',
      resolveDir: process.cwd(),
    },
    outfile,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node24",
  });
  const result = spawnSync(process.execPath, [outfile], { encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 0);
  assert.equal(result.stdout.trim(), "2.5");
  assert.equal(result.stderr, "");
});
test("aborting a real harmless child waits for close and reports uncertain descendant retirement", async () => {
  const controller = new AbortController(),
    timer = setTimeout(() => controller.abort(), 30);
  try {
    await assert.rejects(
      runHelperProcess(process.execPath, ["-e", "setInterval(()=>{},1000)"], {
        signal: controller.signal,
      }),
      (error) => {
        assert.equal(error.code, "DESKTOP_HELPER_BUILD_INTERRUPTED");
        assert.equal(typeof error.childPid, "number");
        assert.throws(() => process.kill(error.childPid, 0));
        return true;
      },
    );
  } finally {
    clearTimeout(timer);
  }
});
