import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  copyHostServiceLauncher,
  hostServiceLauncherSourceFingerprint,
  readHostServiceLauncher,
  validateHostServiceLauncherImage,
} from "./host-service-launcher.mjs";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
function image(machine = 0x8664, subsystem = 2) {
  const bytes = Buffer.alloc(256);
  bytes.write("MZ");
  bytes.writeUInt32LE(64, 0x3c);
  bytes.writeUInt32LE(0x4550, 64);
  bytes.writeUInt16LE(machine, 68);
  bytes.writeUInt16LE(0x20b, 88);
  bytes.writeUInt16LE(subsystem, 156);
  return bytes;
}
async function fixture(context, overrides = {}) {
  const directory = await mkdtemp(join(tmpdir(), "bycoda-host-launcher-"));
  context.after(() =>
    rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }),
  );
  const source = join(directory, "source");
  await mkdir(source);
  const bytes = image();
  const manifest = {
    version: 1,
    target: "win32-x64",
    sourceFingerprint: await hostServiceLauncherSourceFingerprint(),
    sha256: sha256(bytes),
    ...overrides,
  };
  await writeFile(join(source, "bycoda-host-launcher.exe"), bytes);
  await writeFile(join(source, "host-service-launcher.json"), JSON.stringify(manifest));
  return { directory, source, bytes, manifest };
}
test("only the requested Windows GUI architecture is accepted", () => {
  validateHostServiceLauncherImage(image(), "win32-x64");
  validateHostServiceLauncherImage(image(0xaa64), "win32-arm64");
  assert.throws(
    () => validateHostServiceLauncherImage(image(0xaa64), "win32-x64"),
    /matching Windows GUI/,
  );
  assert.throws(
    () => validateHostServiceLauncherImage(image(0x8664, 3), "win32-x64"),
    /matching Windows GUI/,
  );
  assert.throws(() => validateHostServiceLauncherImage(Buffer.alloc(10), "win32-x64"), /Invalid/);
  assert.throws(() => validateHostServiceLauncherImage(image(), "linux-x64"), /Unsupported/);
  const truncated = image();
  truncated.writeUInt32LE(255, 0x3c);
  assert.throws(
    () => validateHostServiceLauncherImage(truncated, "win32-x64"),
    /matching Windows GUI/,
  );
});
test("copies a source-bound verified bundle without changing its receipt", async (context) => {
  const { directory, source, bytes, manifest } = await fixture(context);
  const destination = join(directory, "package");
  const binary = await copyHostServiceLauncher({
    target: "win32-x64",
    directory: source,
    outputDirectory: destination,
  });
  assert.deepEqual(await readFile(binary), bytes);
  assert.deepEqual(
    (await readHostServiceLauncher({ target: "win32-x64", directory: destination })).manifest,
    manifest,
  );
});
test("rejects stale source fingerprints and altered binary checksums", async (context) => {
  const { source, bytes, manifest } = await fixture(context, { sourceFingerprint: "0".repeat(64) });
  await assert.rejects(
    readHostServiceLauncher({ target: "win32-x64", directory: source }),
    /mismatch/,
  );
  manifest.sourceFingerprint = await hostServiceLauncherSourceFingerprint();
  await writeFile(join(source, "host-service-launcher.json"), JSON.stringify(manifest));
  bytes[200] = 1;
  await writeFile(join(source, "bycoda-host-launcher.exe"), bytes);
  await assert.rejects(
    readHostServiceLauncher({ target: "win32-x64", directory: source }),
    /mismatch/,
  );
});
