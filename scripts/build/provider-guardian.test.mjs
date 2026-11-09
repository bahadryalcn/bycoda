import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  open,
  readFile,
  readdir,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  assertGuardianPackagingSeparation,
  copyGuardianBundle,
  guardianFilename,
  guardianManifestName,
  guardianMaxBytes,
  guardianSourceFingerprint,
  guardianTargets,
  parseGuardianBuildArgs,
  readGuardianBundle,
  stageGuardianBundle,
  validateGuardianBinary,
  validateGuardianManifest,
} from "./provider-guardian.mjs";

const fingerprint = "a".repeat(64);
const repository = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "bycoda-guardian-bundle-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}
// These headers exercise packaging validation only, never native execution/proof.
function image(target, discriminator = 0) {
  const bytes = Buffer.alloc(512);
  if (target.startsWith("win32-")) {
    bytes.write("MZ");
    bytes.writeUInt32LE(64, 60);
    bytes.write("PE\0\0", 64);
    bytes.writeUInt16LE(target.endsWith("x64") ? 0x8664 : 0xaa64, 68);
    bytes.writeUInt16LE(2, 86);
    bytes.writeUInt16LE(0x20b, 88);
  } else if (target.startsWith("linux-")) {
    bytes.set([0x7f, 69, 76, 70, 2, 1, 1]);
    bytes.writeUInt16LE(3, 16);
    bytes.writeUInt16LE(target.endsWith("x64") ? 62 : 183, 18);
  } else {
    bytes.writeUInt32LE(0xfeedfacf);
    bytes.writeUInt32LE(target.endsWith("x64") ? 0x01000007 : 0x0100000c, 4);
    bytes.writeUInt32LE(2, 12);
  }
  bytes[511] = discriminator;
  return bytes;
}

test("six exact executable targets reject other architectures, DLLs and unsupported targets", () => {
  assert.equal(Object.keys(guardianTargets).length, 6);
  for (const target of Object.keys(guardianTargets)) {
    validateGuardianBinary(image(target), target);
    for (const other of Object.keys(guardianTargets).filter((value) => value !== target))
      assert.throws(() => validateGuardianBinary(image(other), target), /does not match/);
    assert.throws(() => validateGuardianBinary(Buffer.alloc(127), target), /does not match/);
  }
  const dll = image("win32-x64");
  dll.writeUInt16LE(0x2002, 86);
  assert.throws(() => validateGuardianBinary(dll, "win32-x64"), /does not match/);
  const offset = image("win32-x64");
  offset.writeUInt32LE(0xffffffff, 60);
  assert.throws(() => validateGuardianBinary(offset, "win32-x64"), /does not match/);
  assert.throws(() => guardianFilename("constructor"), /Unsupported/);
});

test("closed manifest validates exact fixed paths, bounds and protocol without fallback", async (t) => {
  const root = await fixture(t);
  const manifest = await stageGuardianBundle(root, "win32-x64", image("win32-x64"), fingerprint);
  for (const mutation of [
    { protocolVersion: 2 },
    { target: "linux-x64" },
    { rustTarget: "aarch64-pc-windows-msvc" },
    { artifact: "../bycoda-provider-guardian.exe" },
    { artifact: "C:\\other.exe" },
    { artifact: "sub/bycoda-provider-guardian.exe" },
    { size: 0 },
    { size: guardianMaxBytes + 1 },
    { size: 1.5 },
    { rawSha256: "A".repeat(64) },
    { sourceFingerprint: "invalid" },
    { buildIdentity: { token: "unrecognized" } },
    { extra: true },
  ])
    assert.throws(
      () => validateGuardianManifest({ ...manifest, ...mutation }, "win32-x64"),
      /Invalid/,
    );
  const missing = { ...manifest };
  delete missing.buildIdentity;
  assert.throws(() => validateGuardianManifest(missing, "win32-x64"), /Invalid/);
});

test("build identity remains closed bounded metadata and is preserved without source-authority conversion", async (t) => {
  const root = await fixture(t);
  const identity = {
    schemaVersion: 1,
    buildId: "fixture",
    version: "0.6.94",
    channel: "dev",
    mode: "host",
    repositoryId: "fixture",
    branch: "main",
    head: "fixture-head",
    sourceFingerprint: "b".repeat(64),
    capturedAt: 1,
    dirtyPaths: [{ path: "fixture.rs", status: "M" }],
    components: { web: "excluded", native: "excluded", host: "included" },
    includedSources: [],
  };
  const manifest = await stageGuardianBundle(
    join(root, "source"),
    "linux-x64",
    image("linux-x64"),
    fingerprint,
    identity,
  );
  assert.deepEqual(manifest.buildIdentity, identity);
  assert.equal(manifest.sourceFingerprint, fingerprint);
  const copied = await copyGuardianBundle(
    join(root, "source"),
    join(root, "copy"),
    "linux-x64",
    fingerprint,
  );
  assert.deepEqual(copied.buildIdentity, identity);
  await assert.rejects(
    stageGuardianBundle(join(root, "invalid"), "linux-x64", image("linux-x64"), fingerprint, {
      ...identity,
      components: { ...identity.components, grant: true },
    }),
    /Invalid/,
  );
  await assert.rejects(
    stageGuardianBundle(join(root, "large"), "linux-x64", image("linux-x64"), fingerprint, {
      ...identity,
      dirtyPaths: Array.from({ length: 2048 }, () => ({ path: "x".repeat(64), status: "M" })),
    }),
    /bounded size/,
  );
});

test("fixed original bytes and manifest are immutable; exact copies remain idempotent", async (t) => {
  const root = await fixture(t);
  const source = join(root, "source"),
    destination = join(root, "destination");
  const first = await stageGuardianBundle(source, "linux-x64", image("linux-x64", 1), fingerprint);
  const originalManifest = await readFile(join(source, guardianManifestName));
  await stageGuardianBundle(source, "linux-x64", image("linux-x64", 1), fingerprint);
  await assert.rejects(
    stageGuardianBundle(source, "linux-x64", image("linux-x64", 2), fingerprint),
    /immutable guardian executable/,
  );
  assert.deepEqual(await readFile(join(source, guardianManifestName)), originalManifest);
  assert.deepEqual(await readFile(join(source, first.artifact)), image("linux-x64", 1));
  await assert.rejects(
    copyGuardianBundle(source, destination, "linux-x64", "b".repeat(64)),
    /source inputs/,
  );
  assert.equal(
    (await copyGuardianBundle(source, destination, "linux-x64", fingerprint)).rawSha256,
    first.rawSha256,
  );
  assert.deepEqual(
    (await readGuardianBundle(destination, "linux-x64")).bytes,
    image("linux-x64", 1),
  );
  await assert.rejects(
    stageGuardianBundle(source, "linux-x64", image("linux-x64", 1), "b".repeat(64)),
    /immutable guardian manifest/,
  );
  assert.deepEqual(await readFile(join(source, guardianManifestName)), originalManifest);
});

test("missing, oversized, wrong-target and tampered bundles fail closed", async (t) => {
  const root = await fixture(t);
  await assert.rejects(readGuardianBundle(root, "win32-x64"), /ENOENT/);
  const manifest = await stageGuardianBundle(root, "win32-x64", image("win32-x64"), fingerprint);
  await assert.rejects(readGuardianBundle(root, "win32-arm64"), /manifest or target/);
  await writeFile(join(root, manifest.artifact), image("win32-x64", 4));
  await assert.rejects(readGuardianBundle(root, "win32-x64"), /checksum/);
  const executable = await open(join(root, manifest.artifact), "r+");
  await executable.truncate(guardianMaxBytes + 1);
  await executable.close();
  await assert.rejects(readGuardianBundle(root, "win32-x64"), /bounded/);
  await writeFile(join(root, guardianManifestName), " ".repeat(64 * 1024 + 1));
  await assert.rejects(readGuardianBundle(root, "win32-x64"), /bounded/);
});

test("failed final source guard does not publish metadata or modify an original manifest", async (t) => {
  const root = await fixture(t);
  await assert.rejects(
    stageGuardianBundle(
      root,
      "darwin-arm64",
      image("darwin-arm64"),
      fingerprint,
      null,
      async () => {
        throw new Error("source changed");
      },
    ),
    /source changed/,
  );
  assert.deepEqual(await readdir(root), [guardianFilename("darwin-arm64")]);
  await assert.rejects(readGuardianBundle(root, "darwin-arm64"), /ENOENT/);
  await stageGuardianBundle(root, "darwin-arm64", image("darwin-arm64"), fingerprint);
  const original = await readFile(join(root, guardianManifestName));
  await assert.rejects(
    stageGuardianBundle(
      root,
      "darwin-arm64",
      image("darwin-arm64"),
      fingerprint,
      null,
      async () => {
        throw new Error("source changed");
      },
    ),
    /source changed/,
  );
  assert.deepEqual(await readFile(join(root, guardianManifestName)), original);
});

async function sourceFixture(root) {
  for (const path of [
    "Cargo.toml",
    "Cargo.lock",
    "package.json",
    "packages/provider-process-guardian/Cargo.toml",
    "packages/provider-process-guardian/package.json",
    "packages/provider-process-guardian/src/main.rs",
    "packages/provider-process-guardian/src/windows_job.rs",
    "scripts/build/provider-guardian.mjs",
    "scripts/build/build-info.mjs",
  ]) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(
      join(root, path),
      path === "package.json" ? JSON.stringify({ version: "0.6.94" }) : path,
    );
  }
}
test("source identity covers workspace, lock, actual shared job and source path additions/deletions", async (t) => {
  const root = await fixture(t);
  await sourceFixture(root);
  let before = await guardianSourceFingerprint(root);
  for (const path of [
    "Cargo.lock",
    "Cargo.toml",
    "packages/provider-process-guardian/src/windows_job.rs",
    "scripts/build/provider-guardian.mjs",
  ]) {
    await writeFile(join(root, path), `${path}:changed`);
    const after = await guardianSourceFingerprint(root);
    assert.notEqual(after, before);
    before = after;
  }
  const added = join(root, "packages/provider-process-guardian/src/added.rs");
  await writeFile(added, "");
  assert.notEqual(await guardianSourceFingerprint(root), before);
  await unlink(added);
  assert.equal(await guardianSourceFingerprint(root), before);
});

test("canonical separation checks all targets and actual junction/directory aliases", async (t) => {
  const root = await fixture(t);
  const output = join(root, "packages"),
    sources = join(root, "sources");
  await mkdir(output);
  await mkdir(sources);
  await assertGuardianPackagingSeparation([sources], output, ["win32-x64", "linux-x64"]);
  const nested = join(output, "linux-x64", "source");
  await mkdir(nested, { recursive: true });
  await assert.rejects(
    assertGuardianPackagingSeparation([nested], output, ["win32-x64", "linux-x64"]),
    /overlap/,
  );
  const alias = join(root, "alias");
  await symlink(nested, alias, process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(
    assertGuardianPackagingSeparation([alias], output, ["win32-x64", "linux-x64"]),
    /overlap/,
  );
  const outside = join(root, "outside");
  await mkdir(outside);
  await symlink(
    outside,
    join(output, "win32-x64"),
    process.platform === "win32" ? "junction" : "dir",
  );
  await assert.rejects(
    assertGuardianPackagingSeparation([sources], output, ["win32-x64"]),
    /escaped/,
  );
});

test("a linked executable cannot become a bundle artifact", async (t) => {
  const root = await fixture(t);
  const manifest = await stageGuardianBundle(root, "linux-x64", image("linux-x64"), fingerprint);
  const outside = join(root, "outside");
  await writeFile(outside, image("linux-x64"));
  await unlink(join(root, manifest.artifact));
  try {
    await symlink(outside, join(root, manifest.artifact), "file");
  } catch (error) {
    if (error.code === "EPERM") {
      t.skip("File symlink privilege unavailable");
      return;
    }
    throw error;
  }
  await assert.rejects(readGuardianBundle(root, "linux-x64"), /redirected|symbolic/);
});

test("explicit build arguments select one target and cannot start all-target or unknown modes", () => {
  assert.equal(
    parseGuardianBuildArgs(["--target", "linux-arm64", "--profile", "debug"]).target,
    "linux-arm64",
  );
  for (const args of [
    ["--all"],
    ["--target"],
    ["--target", "constructor"],
    ["--target", "win32-x64", "--target", "linux-x64"],
    ["--output", "--target", "linux-x64"],
  ])
    assert.throws(() => parseGuardianBuildArgs(args), /Invalid|Unsupported/);
});

function packageFailure(root, args) {
  try {
    execFileSync(
      process.execPath,
      [join(repository, "host/package.mjs"), "--target", "win32-x64", "--directory-only", ...args],
      {
        cwd: root,
        encoding: "utf8",
        windowsHide: true,
        timeout: 10_000,
        env: {
          ...process.env,
          BYCODA_BUILD_MANIFEST: "",
          BYCODA_HOST_RUNTIME_CACHE: join(root, "runtime-cache"),
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    assert.fail("invalid package must refuse before downloading or removing output");
  } catch (error) {
    assert.equal(error.status, 1);
    return error.stderr;
  }
}
test("real packager preflight rejects requested missing guardian and overlap before replacing old output", async (t) => {
  const root = await fixture(t);
  await sourceFixture(root);
  const output = join(root, "build/host-packages/win32-x64");
  await mkdir(output, { recursive: true });
  const sentinel = join(output, "original.txt");
  await writeFile(sentinel, "preserve original");
  assert.match(
    packageFailure(root, ["--provider-guardian", "--provider-guardian-dir", join(root, "missing")]),
    /ENOENT/,
  );
  assert.equal(await readFile(sentinel, "utf8"), "preserve original");
  await stageGuardianBundle(
    output,
    "win32-x64",
    image("win32-x64"),
    await guardianSourceFingerprint(root),
  );
  const before = await readFile(join(output, guardianManifestName));
  assert.match(
    packageFailure(root, [
      "--provider-guardian",
      "--provider-guardian-dir",
      join(root, "build/host-packages"),
    ]),
    /overlap/,
  );
  assert.equal(await readFile(sentinel, "utf8"), "preserve original");
  assert.deepEqual(await readFile(join(output, guardianManifestName)), before);
});

test("real packager cannot silently omit a present invalid or stale default guardian", async (t) => {
  const root = await fixture(t);
  await sourceFixture(root);
  const output = join(root, "build/host-packages/win32-x64");
  await mkdir(output, { recursive: true });
  const sentinel = join(output, "original.txt");
  await writeFile(sentinel, "preserve original");
  const bundle = join(root, "build/host-guardian/win32-x64");
  await mkdir(bundle, { recursive: true });
  await writeFile(join(bundle, guardianManifestName), JSON.stringify({ protocolVersion: 1 }));
  assert.match(packageFailure(root, []), /Invalid guardian manifest/);
  await unlink(join(bundle, guardianManifestName));
  await stageGuardianBundle(
    bundle,
    "win32-x64",
    image("win32-x64"),
    await guardianSourceFingerprint(root),
  );
  await writeFile(join(root, "Cargo.lock"), "new lock inputs");
  assert.match(packageFailure(root, []), /source\/artifact mismatch/);
  assert.equal(await readFile(sentinel, "utf8"), "preserve original");
});
