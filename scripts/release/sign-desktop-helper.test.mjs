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
