import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  admissionSourceFingerprint,
  admissionTargets,
  assertAdmissionPackagingSeparation,
  copyAdmissionBundle,
  readAdmissionBundle,
  stageAdmissionBundle,
  validateAdmissionBinary,
  validateAdmissionLoadPath,
} from "./physical-store-admission.mjs";

const fingerprint = "a".repeat(64);
const repository = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
test("Windows load budget includes its namespace and UTF-8 byte length", (t) => {
  if (process.platform !== "win32") {
    t.skip("Windows Node/SQLite limit");
    return;
  }
  validateAdmissionLoadPath(`C:\\${"a".repeat(248)}.node`);
  assert.throws(() => validateAdmissionLoadPath(`C:\\${"a".repeat(249)}.node`), /260 UTF-8 bytes/);
  assert.throws(() => validateAdmissionLoadPath(`C:\\${"ğ".repeat(128)}.node`), /260 UTF-8 bytes/);
});
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "bycoda-admission-bundle-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}
// Header fixtures test packaging boundaries, not whether a native image executes.
function image(target, discriminator = 0) {
  const bytes = Buffer.alloc(512);
  if (target.startsWith("win32-")) {
    bytes.write("MZ");
    bytes.writeUInt32LE(64, 60);
    bytes.write("PE\0\0", 64);
    bytes.writeUInt16LE(target.endsWith("x64") ? 0x8664 : 0xaa64, 68);
    bytes.writeUInt16LE(0x2000, 86);
    bytes.writeUInt16LE(0x20b, 88);
  } else if (target.startsWith("linux-")) {
    bytes.set([0x7f, 69, 76, 70, 2, 1, 1]);
    bytes.writeUInt16LE(3, 16);
    bytes.writeUInt16LE(target.endsWith("x64") ? 62 : 183, 18);
  } else {
    bytes.writeUInt32LE(0xfeedfacf);
    bytes.writeUInt32LE(target.endsWith("x64") ? 0x01000007 : 0x0100000c, 4);
    bytes.writeUInt32LE(6, 12);
  }
  bytes[511] = discriminator;
  return bytes;
}

test("each target rejects every other architecture/format and malformed images", () => {
  for (const target of Object.keys(admissionTargets)) {
    validateAdmissionBinary(image(target), target);
    for (const other of Object.keys(admissionTargets).filter((other) => other !== target))
      assert.throws(() => validateAdmissionBinary(image(other), target), /does not match/);
    assert.throws(() => validateAdmissionBinary(Buffer.alloc(8), target), /does not match/);
  }
  const bytes = image("win32-x64");
  bytes.writeUInt32LE(0xffffffff, 60);
  assert.throws(() => validateAdmissionBinary(bytes, "win32-x64"), /does not match/);
  assert.throws(() => validateAdmissionBinary(bytes, "constructor"), /Unsupported/);
});

test("successors keep loaded artifacts immutable and validation failure preserves the old manifest", async (t) => {
  const root = await fixture(t);
  const first = await stageAdmissionBundle(root, "win32-x64", image("win32-x64", 1), fingerprint);
  const before = await readFile(join(root, "physical-store-admission.json"));
  await assert.rejects(
    stageAdmissionBundle(root, "win32-x64", image("win32-x64", 2), fingerprint, async () => {
      throw new Error("ABI validation rejected image");
    }),
    /ABI validation/,
  );
  assert.deepEqual(await readFile(join(root, "physical-store-admission.json")), before);
  const second = await stageAdmissionBundle(root, "win32-x64", image("win32-x64", 3), fingerprint);
  assert.notEqual(second.artifact, first.artifact);
  assert.deepEqual(await readFile(join(root, first.artifact)), image("win32-x64", 1));
  assert.equal((await readAdmissionBundle(root, "win32-x64")).manifest.sha256, second.sha256);
});

test("packaging rejects stale source, wrong target, checksum drift, path escape and oversized metadata", async (t) => {
  const root = await fixture(t);
  const source = join(root, "source");
  const destination = join(root, "destination");
  const manifest = await stageAdmissionBundle(source, "win32-x64", image("win32-x64"), fingerprint);
  await assert.rejects(
    copyAdmissionBundle(source, destination, "win32-x64", "b".repeat(64)),
    /source inputs/,
  );
  await assert.rejects(readAdmissionBundle(source, "win32-arm64"), /target/);
  const copied = await copyAdmissionBundle(source, destination, "win32-x64", fingerprint);
  assert.equal(copied.sha256, manifest.sha256);
  await writeFile(join(source, manifest.artifact), image("win32-x64", 42));
  await assert.rejects(readAdmissionBundle(source, "win32-x64"), /checksum/);
  await assert.rejects(
    stageAdmissionBundle(source, "win32-x64", image("win32-x64"), fingerprint),
    /immutable/,
  );
  await writeFile(
    join(source, "physical-store-admission.json"),
    JSON.stringify({ ...manifest, artifact: "../escape.node" }),
  );
  await assert.rejects(readAdmissionBundle(source, "win32-x64"), /manifest/);
  await writeFile(join(source, "physical-store-admission.json"), " ".repeat(8193));
  await assert.rejects(readAdmissionBundle(source, "win32-x64"), /bounded/);
});

test("a linked artifact directory cannot redirect staging outside the selected bundle", async (t) => {
  const root = await fixture(t);
  const output = join(root, "output");
  const outside = join(root, "outside");
  await mkdir(output);
  await mkdir(outside);
  const staged = await stageAdmissionBundle(
    join(root, "seed"),
    "win32-x64",
    image("win32-x64"),
    fingerprint,
  );
  try {
    await symlink(
      outside,
      join(output, staged.artifact),
      process.platform === "win32" ? "junction" : "dir",
    );
  } catch (error) {
    if (error.code === "EPERM") {
      t.skip("Directory link creation unavailable");
      return;
    }
    throw error;
  }
  await assert.rejects(stageAdmissionBundle(output, "win32-x64", image("win32-x64"), fingerprint));
  assert.deepEqual(await readdir(outside), []);
});

async function sourceFixture(root) {
  for (const name of [
    "Cargo.toml",
    "Cargo.lock",
    "scripts/build/physical-store-admission.mjs",
    "packages/physical-store-admission/src/lib.rs",
    "packages/physical-store-admission-node/src/lib.rs",
    "vendor/sqlite-extension-abi/sqlite3.h",
  ]) {
    await mkdir(dirname(join(root, name)), { recursive: true });
    await writeFile(join(root, name), name);
  }
}

test("native source identity includes the shared core, extension headers, lock and build helper", async (t) => {
  const root = await fixture(t);
  await sourceFixture(root);
  const first = await admissionSourceFingerprint(root);
  await mkdir(join(root, "packages/physical-store-admission-node/test"));
  await writeFile(
    join(root, "packages/physical-store-admission-node/test/fixture.mjs"),
    "test only",
  );
  assert.equal(await admissionSourceFingerprint(root), first);
  for (const name of [
    "Cargo.lock",
    "scripts/build/physical-store-admission.mjs",
    "vendor/sqlite-extension-abi/sqlite3.h",
    "packages/physical-store-admission/src/lib.rs",
  ]) {
    const before = await admissionSourceFingerprint(root);
    await writeFile(join(root, name), "changed");
    assert.notEqual(await admissionSourceFingerprint(root), before, name);
  }
});

test("missing native input fails package preflight before replacing an existing package or fetching Node", async (t) => {
  const root = await fixture(t);
  await sourceFixture(root);
  await writeFile(join(root, "package.json"), '{"version":"0.6.94"}');
  const sentinel = join(root, "build/host-packages/win32-x64/owner-sentinel");
  await mkdir(dirname(sentinel), { recursive: true });
  await writeFile(sentinel, "preserved");
  const result = spawnSync(
    process.execPath,
    [
      join(repository, "host/package.mjs"),
      "--target",
      "win32-x64",
      "--native-admission",
      "--directory-only",
    ],
    { cwd: root, encoding: "utf8", windowsHide: true, timeout: 10_000 },
  );
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /ENOENT|no such file/i);
  assert.equal(await readFile(sentinel, "utf8"), "preserved");
});

test("overlapping native inputs survive package preflight, including a canonical directory alias", async (t) => {
  const root = await fixture(t);
  await sourceFixture(root);
  await writeFile(join(root, "package.json"), '{"version":"0.6.94"}');
  const base = join(root, "build/host-packages");
  const source = join(base, "win32-x64");
  const manifest = await stageAdmissionBundle(
    source,
    "win32-x64",
    image("win32-x64"),
    await admissionSourceFingerprint(root),
  );
  const sentinel = join(source, "owner-sentinel");
  await writeFile(sentinel, "preserved");
  const aliases = [base];
  const alias = join(root, "input-alias");
  try {
    await symlink(base, alias, process.platform === "win32" ? "junction" : "dir");
    aliases.push(alias);
  } catch (error) {
    if (error.code !== "EPERM") throw error;
    t.diagnostic("Directory alias unavailable; direct overlap is still exercised");
  }
  for (const directory of aliases) {
    const result = spawnSync(
      process.execPath,
      [
        join(repository, "host/package.mjs"),
        "--target",
        "win32-x64",
        "--native-admission",
        "--native-admission-dir",
        directory,
        "--directory-only",
      ],
      { cwd: root, encoding: "utf8", windowsHide: true, timeout: 10_000 },
    );
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /source and package output overlap/);
    assert.equal(await readFile(sentinel, "utf8"), "preserved");
    assert.deepEqual((await readAdmissionBundle(source, "win32-x64")).manifest, manifest);
  }
});

test("canonical output path budget refuses a long junction target before deleting its existing package", async (t) => {
  if (process.platform !== "win32") {
    t.skip("Windows Node/SQLite path budget");
    return;
  }
  const root = await fixture(t);
  await sourceFixture(root);
  await writeFile(join(root, "package.json"), '{"version":"0.6.94"}');
  const native = join(root, "native-inputs", "win32-x64");
  await stageAdmissionBundle(
    native,
    "win32-x64",
    image("win32-x64"),
    await admissionSourceFingerprint(root),
  );
  const longOutput = join(root, "long-" + "a".repeat(90), "deep-" + "b".repeat(90));
  const existing = join(longOutput, "win32-x64", "owner-sentinel");
  await mkdir(dirname(existing), { recursive: true });
  await writeFile(existing, "preserved");
  await mkdir(join(root, "build"));
  try {
    await symlink(longOutput, join(root, "build/host-packages"), "junction");
  } catch (error) {
    if (error.code === "EPERM") {
      t.skip("Directory link creation unavailable");
      return;
    }
    throw error;
  }
  const child = spawnSync(
    process.execPath,
    [
      join(repository, "host/package.mjs"),
      "--target",
      "win32-x64",
      "--native-admission",
      "--native-admission-dir",
      join(root, "native-inputs"),
      "--directory-only",
    ],
    { cwd: root, encoding: "utf8", windowsHide: true, timeout: 10_000 },
  );
  assert.equal(child.status, 1, child.stderr);
  assert.match(child.stderr, /260 UTF-8 bytes/);
  assert.equal(await readFile(existing, "utf8"), "preserved");
});

test("an existing package output alias cannot redirect replacement outside the output root", async (t) => {
  const root = await fixture(t);
  const input = join(root, "input");
  const output = join(root, "output");
  const outside = join(root, "outside");
  await mkdir(join(input, "win32-x64"), { recursive: true });
  await mkdir(output);
  await mkdir(outside);
  try {
    await symlink(
      outside,
      join(output, "win32-x64"),
      process.platform === "win32" ? "junction" : "dir",
    );
  } catch (error) {
    if (error.code === "EPERM") {
      t.skip("Directory link creation unavailable");
      return;
    }
    throw error;
  }
  await assert.rejects(
    assertAdmissionPackagingSeparation(input, output, ["win32-x64"]),
    /output escaped/,
  );
});
