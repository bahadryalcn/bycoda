import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile, appendFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { signDesktopHelperBundle } from "./sign-desktop-helper.mjs";
import {
  AGENT_DESKTOP_SOURCE,
  desktopHelperPlan,
  copyDesktopHelperBundle,
  readDesktopHelperBundle,
} from "../setup/agent-desktop.mjs";
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex"),
  thumbprint = "AB".repeat(20);
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "bycoda-helper-signing-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const plan = desktopHelperPlan({
    cacheRoot: join(root, "cache"),
    platform: "win32",
    arch: "x64",
  });
  await mkdir(plan.bundleDir, { recursive: true });
  const files = [];
  for (const name of plan.files) {
    const bytes =
      name === "LICENSE"
        ? await readFile(new URL("../../vendor/agent-desktop/LICENSE", import.meta.url))
        : Buffer.from("unsigned native fixture");
    await writeFile(join(plan.bundleDir, name), bytes);
    files.push({ name, size: bytes.length, sha256: hash(bytes) });
  }
  const manifest = {
    schema: 1,
    source: { ...AGENT_DESKTOP_SOURCE },
    platform: "win32",
    arch: "x64",
    target: plan.target,
    binary: plan.binary,
    toolchain: AGENT_DESKTOP_SOURCE.rustToolchain,
    compiler: "fixture",
    builtAt: new Date().toISOString(),
    files,
  };
  await writeFile(join(plan.bundleDir, "manifest.json"), JSON.stringify(manifest));
  const packageRoot = join(root, "packages"),
    bundle = join(packageRoot, "win32-x64", "agent-desktop");
  await mkdir(join(packageRoot, "win32-x64"), { recursive: true });
  await copyDesktopHelperBundle(plan.bundleDir, bundle, { platform: "win32", arch: "x64" });
  const options = {
    packageRoot,
    platform: "win32",
    arch: "x64",
    certificateThumbprint: thumbprint,
  };
  // Fake verifier boundary only. These bytes are not an Authenticode signature.
  const signer = async ({ binaryPath, expectedSha256 }) => {
    assert.equal(hash(await readFile(binaryPath)), expectedSha256);
    await appendFile(binaryPath, "\nfixture verifier accepted\n");
    return {
      status: "Valid",
      signerThumbprint: thumbprint,
      timestamped: true,
      sha256: hash(await readFile(binaryPath)),
    };
  };
  return { plan, manifest, packageRoot, bundle, options, signer };
}
test("signing the package copy updates final hashes while preserving the pinned cache and source/license proof", async (t) => {
  const f = await fixture(t),
    cacheBefore = await readDesktopHelperBundle(f.plan.bundleDir, {
      platform: "win32",
      arch: "x64",
    });
  const result = await signDesktopHelperBundle(f.bundle, { ...f.options, signer: f.signer });
  assert.notEqual(result.binarySha256, cacheBefore.binarySha256);
  assert.deepEqual(result.manifest.source, f.manifest.source);
  assert.equal(result.manifest.signing.unsignedSha256, cacheBefore.binarySha256);
  assert.equal(result.manifest.signing.signedSha256, result.binarySha256);
  assert.equal(
    (await readDesktopHelperBundle(f.plan.bundleDir, { platform: "win32", arch: "x64" }))
      .binarySha256,
    cacheBefore.binarySha256,
  );
  assert.deepEqual(
    result.manifest.files.find((file) => file.name === "LICENSE"),
    f.manifest.files.find((file) => file.name === "LICENSE"),
  );
  await assert.rejects(
    signDesktopHelperBundle(f.bundle, { ...f.options, signer: f.signer }),
    /already has a signing receipt/,
  );
});
for (const [label, change] of [
  ["wrong signer", (receipt) => ({ ...receipt, signerThumbprint: "CD".repeat(20) })],
  ["missing timestamp", (receipt) => ({ ...receipt, timestamped: false })],
  ["changed bytes", (receipt) => ({ ...receipt, sha256: "0".repeat(64) })],
])
  test(`refuses ${label} without blessing changed bytes or replaying signing`, async (t) => {
    const f = await fixture(t);
    let calls = 0;
    const signer = async (input) => {
      calls++;
      return change(await f.signer(input));
    };
    await assert.rejects(
      signDesktopHelperBundle(f.bundle, { ...f.options, signer }),
      /verified, timestamped/,
    );
    assert.equal(
      JSON.parse(await readFile(join(f.bundle, "manifest.json"), "utf8")).signing,
      undefined,
    );
    await assert.rejects(signDesktopHelperBundle(f.bundle, { ...f.options, signer }), /checksum/);
    assert.equal(calls, 1);
  });
test("refuses cache paths, missing certificate identity and packaging without explicit helper admission", async (t) => {
  const f = await fixture(t);
  let called = false;
  const signer = async () => {
    called = true;
    throw new Error("must not run");
  };
  await assert.rejects(
    signDesktopHelperBundle(f.plan.bundleDir, { ...f.options, signer }),
    /package copy/,
  );
  await assert.rejects(
    signDesktopHelperBundle(f.bundle, { ...f.options, certificateThumbprint: undefined, signer }),
    /Configure BYCODA/,
  );
  assert.equal(called, false);
  assert.throws(
    () =>
      execFileSync(process.execPath, ["host/package.mjs", "--sign-desktop-helper"], {
        windowsHide: true,
        encoding: "utf8",
        stdio: "pipe",
      }),
    /requires one local Windows target/,
  );
});

const identity = "Developer ID Application: Bycoda Test (TEAM123456)";
async function macFixture(t) {
  const root = await mkdtemp(join(tmpdir(), "bycoda-helper-macsigning-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const plan = desktopHelperPlan({
    cacheRoot: join(root, "cache"),
    platform: "darwin",
    arch: "arm64",
  });
  await mkdir(plan.bundleDir, { recursive: true });
  const files = [];
  for (const name of plan.files) {
    const bytes =
      name === "LICENSE"
        ? await readFile(new URL("../../vendor/agent-desktop/LICENSE", import.meta.url))
        : Buffer.from(`unsigned ${name}`);
    await writeFile(join(plan.bundleDir, name), bytes);
    files.push({ name, size: bytes.length, sha256: hash(bytes) });
  }
  const manifest = {
    schema: 1,
    source: { ...AGENT_DESKTOP_SOURCE },
    platform: "darwin",
    arch: "arm64",
    target: plan.target,
    binary: plan.binary,
    toolchain: AGENT_DESKTOP_SOURCE.rustToolchain,
    compiler: "fixture",
    builtAt: new Date().toISOString(),
    files,
  };
  await writeFile(join(plan.bundleDir, "manifest.json"), JSON.stringify(manifest));
  const packageRoot = join(root, "packages"),
    bundle = join(packageRoot, "darwin-arm64", "agent-desktop");
  await mkdir(join(packageRoot, "darwin-arm64"), { recursive: true });
  await copyDesktopHelperBundle(plan.bundleDir, bundle, { platform: "darwin", arch: "arm64" });
  const options = { packageRoot, platform: "darwin", arch: "arm64", identity };
  // Fake codesign boundary only: appended bytes are not a Mach-O signature.
  const signer = async ({ binaryPath, expectedSha256, identifier }) => {
    assert.equal(hash(await readFile(binaryPath)), expectedSha256);
    await appendFile(binaryPath, "\nfixture codesign\n");
    return {
      status: "Valid",
      identifier,
      authority: [identity, "Developer ID Certification Authority", "Apple Root CA"],
      teamIdentifier: "TEAM123456",
      hardenedRuntime: true,
      timestamped: true,
      sha256: hash(await readFile(binaryPath)),
    };
  };
  return { plan, packageRoot, bundle, options, signer };
}
test("macOS signing covers every executable, records a receipt and refuses re-signing", async (t) => {
  const f = await macFixture(t),
    cacheBefore = await readDesktopHelperBundle(f.plan.bundleDir, {
      platform: "darwin",
      arch: "arm64",
    });
  const ids = [];
  const signer = async (input) => (ids.push(input.identifier), f.signer(input));
  const result = await signDesktopHelperBundle(f.bundle, { ...f.options, signer });
  assert.deepEqual(ids.sort(), [
    "com.bycoda.desktop.agent-desktop",
    "com.bycoda.desktop.agent-desktop-macos-helper",
  ]);
  assert.equal(result.manifest.signing.kind, "macos-codesign");
  assert.equal(result.manifest.signing.files.length, 2);
  assert.equal(result.manifest.signing.files[0].teamIdentifier, "TEAM123456");
  assert.notEqual(result.binarySha256, cacheBefore.binarySha256);
  assert.equal(
    (await readDesktopHelperBundle(f.plan.bundleDir, { platform: "darwin", arch: "arm64" }))
      .binarySha256,
    cacheBefore.binarySha256,
  );
  await assert.rejects(
    signDesktopHelperBundle(f.bundle, { ...f.options, signer }),
    /already has a signing receipt/,
  );
});
test("macOS signing refuses the cache, a missing identity and unverified receipts", async (t) => {
  const f = await macFixture(t);
  let called = false;
  const never = async () => {
    called = true;
    throw new Error("must not run");
  };
  await assert.rejects(
    signDesktopHelperBundle(f.plan.bundleDir, { ...f.options, signer: never }),
    /package copy/,
  );
  await assert.rejects(
    signDesktopHelperBundle(f.bundle, { ...f.options, identity: "", signer: never }),
    /Configure BYCODA_MACOS_SIGNING_IDENTITY/,
  );
  assert.equal(called, false);
});
for (const [label, change] of [
  ["unhardened", (r) => ({ ...r, hardenedRuntime: false })],
  ["untimestamped", (r) => ({ ...r, timestamped: false })],
  ["foreign authority", (r) => ({ ...r, authority: ["Developer ID Application: Other (X)"] })],
  ["wrong identifier", (r) => ({ ...r, identifier: "other.identifier" })],
])
  test(`macOS signing refuses ${label} receipts and leaves no receipt`, async (t) => {
    const f = await macFixture(t);
    await assert.rejects(
      signDesktopHelperBundle(f.bundle, {
        ...f.options,
        signer: async (input) => change(await f.signer(input)),
      }),
      /verified, timestamped, hardened-runtime/,
    );
    assert.equal(
      JSON.parse(await readFile(join(f.bundle, "manifest.json"), "utf8")).signing,
      undefined,
    );
  });
test("other platforms keep refusing helper signing", async (t) => {
  const f = await fixture(t);
  await assert.rejects(
    signDesktopHelperBundle(f.bundle, { ...f.options, platform: "linux", signer: f.signer }),
    /requires Windows or macOS/,
  );
});
