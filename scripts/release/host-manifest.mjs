/** Six standalone Host archives, bound to the same immutable source candidate. */
import assert from "node:assert/strict";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseBuildIdentity } from "../build/build-info.mjs";
import { digest, packageFile } from "./package-manifest.mjs";
import { validateCandidate } from "./release-candidate.mjs";
import { parseSha256Sum } from "./checksum.mjs";

export const hostTargets = [
  "darwin-arm64",
  "darwin-x64",
  "linux-arm64",
  "linux-x64",
  "win32-arm64",
  "win32-x64",
];
export function validateHostManifest(manifest, root, candidate) {
  validateCandidate(candidate);
  assert(
    manifest?.schemaVersion === 1 &&
      manifest.kind === "standalone-host-packages" &&
      manifest.candidateDigest === candidate.receiptSha256 &&
      manifest.sourceSha === candidate.sha &&
      manifest.version === candidate.version,
    "Foreign Host package identity",
  );
  const stamp = parseBuildIdentity(manifest.buildIdentity);
  assert(
    stamp &&
      stamp.head === candidate.sha &&
      stamp.version === candidate.version &&
      stamp.channel === candidate.channel,
    "Invalid standalone Host stamp",
  );
  assert.deepEqual(
    manifest.packages?.map((entry) => entry.target),
    hostTargets,
    "All six supported Host targets are required exactly once",
  );
  let total = 0;
  for (const entry of manifest.packages) {
    const expected = `bycoda-host-${entry.target}.${entry.target.startsWith("win32-") ? "zip" : "tar.gz"}`;
    assert.equal(entry.archive?.path, expected);
    assert.equal(entry.archive.role, "hostArchive");
    assert.deepEqual(
      packageFile(root, expected, "hostArchive"),
      entry.archive,
      "Host archive bytes differ",
    );
    assert.equal(entry.checksum?.path, `${expected}.sha256`);
    assert.deepEqual(packageFile(root, entry.checksum.path, "checksum"), entry.checksum);
    assert.equal(
      parseSha256Sum(readFileSync(path.join(root, entry.checksum.path), "utf8"), expected),
      entry.archive.sha256,
      "Host checksum differs",
    );
    assert(
      entry.identity?.version === candidate.version &&
        entry.identity.target === entry.target &&
        entry.identity.buildIdentity?.sourceFingerprint === stamp.sourceFingerprint &&
        entry.identity.buildIdentity?.head === candidate.sha,
      "Host payload identity differs",
    );
    total += entry.archive.bytes;
  }
  assert(
    total <= 2 * 1024 * 1024 * 1024 &&
      manifest.artifactDigest === digest(JSON.stringify(manifest.packages)),
    "Host manifest digest/bound differs",
  );
  return manifest;
}
export function stageHostPackages({ candidate, root, destination }) {
  validateCandidate(candidate);
  assert(
    !existsSync(path.join(destination, "host-manifest.json")),
    "Host package staging is immutable",
  );
  const buildIdentity = parseBuildIdentity(
    JSON.parse(readFileSync(path.join(root, "build/build-info.json"), "utf8")),
  );
  const folder = path.join(root, "build/host-packages");
  const packages = hostTargets.map((target) => {
    const filename = `bycoda-host-${target}.${target.startsWith("win32-") ? "zip" : "tar.gz"}`;
    return {
      target,
      archive: packageFile(folder, filename, "hostArchive"),
      checksum: packageFile(folder, `${filename}.sha256`, "checksum"),
      identity: JSON.parse(readFileSync(path.join(folder, target, "version.json"), "utf8")),
    };
  });
  const manifest = {
    schemaVersion: 1,
    kind: "standalone-host-packages",
    candidateDigest: candidate.receiptSha256,
    sourceSha: candidate.sha,
    version: candidate.version,
    buildIdentity,
    packages,
    artifactDigest: digest(JSON.stringify(packages)),
    scope: "Byte/source provenance only; standalone target execution is separate acceptance.",
  };
  validateHostManifest(manifest, folder, candidate);
  mkdirSync(destination, { recursive: true });
  for (const entry of packages)
    for (const file of [entry.archive, entry.checksum])
      copyFileSync(path.join(folder, file.path), path.join(destination, file.path));
  writeFileSync(
    path.join(destination, "host-manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    { flag: "wx" },
  );
  return manifest;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [candidateFile, destination] = process.argv.slice(2);
  assert(candidateFile && destination, "Expected candidate file and staging directory");
  stageHostPackages({
    candidate: JSON.parse(readFileSync(candidateFile, "utf8")),
    root: process.cwd(),
    destination,
  });
}
