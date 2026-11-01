/** Exact-candidate portable build artifact. Native/runtime packaging stays per platform. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseBuildIdentity, sourceIdentity } from "./build-info.mjs";
import { validateCandidate } from "../release/release-candidate.mjs";

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const allowed = (name) =>
  /^(?:dist\/|build\/host\/)/.test(name) || name === "build/build-info.json";
function safePath(root, name) {
  assert(
    typeof name === "string" && name.length < 1024 && !name.includes("\\"),
    "Invalid common artifact path",
  );
  assert(
    name.split("/").every((part) => part && part !== "." && part !== ".." && !part.includes(":")),
    "Unsafe common artifact path",
  );
  const target = path.join(root, ...name.split("/"));
  let cursor = root;
  assert(!lstatSync(root).isSymbolicLink(), "Artifact root cannot be a link");
  for (const part of name.split("/")) {
    cursor = path.join(cursor, part);
    if (existsSync(cursor))
      assert(!lstatSync(cursor).isSymbolicLink(), "Artifact path cannot contain links");
  }
  return target;
}
function inventory(root, name, result = []) {
  const file = safePath(root, name),
    stat = lstatSync(file);
  if (stat.isDirectory()) {
    for (const child of readdirSync(file).sort()) inventory(root, `${name}/${child}`, result);
  } else {
    assert(stat.isFile() && stat.size <= 64 * 1024 * 1024, "Invalid common artifact file");
    result.push({ path: name, size: stat.size, sha256: hash(readFileSync(file)) });
  }
  return result;
}
function validateIdentity(candidate, identity) {
  assert(
    identity &&
      identity.head === candidate.sha &&
      identity.version === candidate.version &&
      identity.channel === candidate.channel &&
      identity.mode === "release-candidate",
    "Common artifact identity differs from candidate",
  );
  assert.equal(identity.buildId, `candidate-${candidate.receiptSha256.slice(0, 24)}`);
}
export function validateCommonArtifact(candidate, artifact) {
  validateCandidate(candidate);
  const manifestFile = safePath(artifact, "manifest.json");
  assert(lstatSync(manifestFile).size <= 2 * 1024 * 1024, "Common manifest exceeds size limit");
  const manifest = JSON.parse(readFileSync(manifestFile, "utf8"));
  assert(
    manifest.schemaVersion === 1 &&
      manifest.kind === "release-common" &&
      manifest.candidateDigest === candidate.receiptSha256,
    "Wrong common artifact candidate",
  );
  assert(
    Array.isArray(manifest.files) && manifest.files.length > 0 && manifest.files.length <= 5000,
    "Invalid common inventory",
  );
  const seen = new Set();
  let total = 0;
  for (const file of manifest.files) {
    assert(
      allowed(file.path) && !seen.has(file.path),
      "Unexpected or duplicate common artifact file",
    );
    seen.add(file.path);
    const target = safePath(artifact, file.path),
      stat = lstatSync(target);
    assert(
      stat.isFile() && stat.size === file.size && stat.size <= 64 * 1024 * 1024,
      "Common artifact size differs",
    );
    total += stat.size;
    assert(total <= 512 * 1024 * 1024, "Common artifact exceeds size limit");
    assert.equal(
      hash(readFileSync(target)),
      file.sha256,
      `Common artifact bytes differ: ${file.path}`,
    );
  }
  for (const required of [
    "dist/index.html",
    "dist/quick-composer.html",
    "dist/voice-overlay.html",
    "dist/build-info.json",
    "build/build-info.json",
    "build/host/host.mjs",
    "build/host/bycoda-host.mjs",
    "build/host/provider-guard.mjs",
    "build/host/host-notes-worker.mjs",
    "build/host/store-worker.mjs",
    "build/host/snapshot-worker.mjs",
  ])
    assert(seen.has(required), `Missing common output: ${required}`);
  const actual = [
    ...inventory(artifact, "dist"),
    ...inventory(artifact, "build/host"),
    ...inventory(artifact, "build/build-info.json"),
  ];
  assert.deepEqual(
    actual.map((file) => file.path).sort(),
    [...seen].sort(),
    "Common artifact contains unlisted outputs",
  );
  const identity = parseBuildIdentity(
    JSON.parse(readFileSync(safePath(artifact, "build/build-info.json"), "utf8")),
  );
  validateIdentity(candidate, identity);
  assert.deepEqual(
    JSON.parse(readFileSync(safePath(artifact, "dist/build-info.json"), "utf8")),
    identity,
    "Web identity differs from Host/native identity",
  );
  return { manifest, identity };
}
async function verifySource(root, identity) {
  const current = await sourceIdentity(root);
  assert(
    current.head === identity.head &&
      current.sourceFingerprint === identity.sourceFingerprint &&
      JSON.stringify(current.dirtyPaths) === JSON.stringify(identity.dirtyPaths),
    "Common artifact source bytes differ from packaging checkout",
  );
}
export async function stageCommonArtifact(candidate, root, artifact) {
  assert(!existsSync(artifact), "Common artifact is immutable");
  const identity = parseBuildIdentity(
    JSON.parse(readFileSync(path.join(root, "build/build-info.json"), "utf8")),
  );
  validateIdentity(candidate, identity);
  await verifySource(root, identity);
  const files = [
    ...inventory(root, "dist"),
    ...inventory(root, "build/host"),
    ...inventory(root, "build/build-info.json"),
  ];
  mkdirSync(artifact, { recursive: true });
  for (const file of files) {
    const target = safePath(artifact, file.path);
    mkdirSync(path.dirname(target), { recursive: true });
    copyFileSync(safePath(root, file.path), target);
  }
  writeFileSync(
    path.join(artifact, "manifest.json"),
    JSON.stringify(
      { schemaVersion: 1, kind: "release-common", candidateDigest: candidate.receiptSha256, files },
      null,
      2,
    ) + "\n",
    { flag: "wx" },
  );
  validateCommonArtifact(candidate, artifact);
  await verifySource(root, identity);
}
export async function consumeCommonArtifact(candidate, root, artifact, restore = false) {
  const { manifest, identity } = validateCommonArtifact(candidate, artifact);
  await verifySource(root, identity);
  for (const file of manifest.files) {
    const target = safePath(root, file.path);
    if (restore) {
      mkdirSync(path.dirname(target), { recursive: true });
      copyFileSync(safePath(artifact, file.path), target);
    }
    assert.equal(
      hash(readFileSync(target)),
      file.sha256,
      `Consumed common output changed: ${file.path}`,
    );
  }
  const actual = [
    ...inventory(root, "dist"),
    ...inventory(root, "build/host"),
    ...inventory(root, "build/build-info.json"),
  ];
  assert.deepEqual(
    actual.map((file) => file.path).sort(),
    manifest.files.map((file) => file.path).sort(),
    "Packaging checkout contains unlisted common outputs",
  );
  await verifySource(root, identity);
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [command, candidateFile, artifactDirectory] = process.argv.slice(2);
  assert(
    ["stage", "restore", "verify"].includes(command) && candidateFile && artifactDirectory,
    "Usage: release-common.mjs stage|restore|verify candidate.json artifact-directory",
  );
  const candidate = validateCandidate(JSON.parse(readFileSync(candidateFile, "utf8")));
  const root = process.cwd(),
    artifact = path.resolve(artifactDirectory);
  if (command === "stage") await stageCommonArtifact(candidate, root, artifact);
  else await consumeCommonArtifact(candidate, root, artifact, command === "restore");
  console.log(`Common release build ${command}: ${candidate.sha}, ${candidate.receiptSha256}`);
}
