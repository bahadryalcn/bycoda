/** Controlled version-only overlay in an ephemeral CI checkout. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { captureBuildIdentity, sourceIdentity, parseBuildIdentity } from "../build/build-info.mjs";
import { isSignedChannel, validateCandidate } from "./release-candidate.mjs";

export const versionFiles = [
  "package.json",
  "Cargo.toml",
  "Cargo.lock",
  "src-tauri/tauri.conf.json",
];
export function versionOverlay(source, candidate) {
  validateCandidate(candidate);
  const next = { ...source };
  for (const name of versionFiles)
    assert(typeof source[name] === "string", `Missing version input: ${name}`);
  for (const name of ["package.json", "src-tauri/tauri.conf.json"]) {
    const data = JSON.parse(source[name]);
    assert.equal(
      data.version,
      candidate.sourceVersion,
      "Source version differs from checked candidate",
    );
    next[name] = source[name].replace(/("version"\s*:\s*")[^"]+("?)/, `$1${candidate.version}$2`);
  }
  assert(source["Cargo.toml"].includes(`version = "${candidate.sourceVersion}"`));
  next["Cargo.toml"] = source["Cargo.toml"].replace(
    /^(version = ")[^"]+("\s*)$/m,
    `$1${candidate.version}$2`,
  );
  assert(
    source["Cargo.lock"].includes(`name = "bycoda"\nversion = "${candidate.sourceVersion}"`) ||
      source["Cargo.lock"].includes(`name = "bycoda"\r\nversion = "${candidate.sourceVersion}"`),
    "Cargo lock source version differs",
  );
  next["Cargo.lock"] = source["Cargo.lock"].replace(
    /(name = "bycoda"\r?\nversion = ")[^"]+("?)/,
    `$1${candidate.version}$2`,
  );
  return next;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  assert.equal(
    process.env.GITHUB_ACTIONS,
    "true",
    "Candidate preparation is restricted to ephemeral CI checkouts",
  );
  if (process.argv[2] === "--verify") {
    const stamp = parseBuildIdentity(JSON.parse(readFileSync("build/build-info.json", "utf8"))),
      current = await sourceIdentity(process.cwd());
    assert(
      stamp &&
        stamp.head === current.head &&
        stamp.sourceFingerprint === current.sourceFingerprint &&
        JSON.stringify(stamp.dirtyPaths) === JSON.stringify(current.dirtyPaths),
      "Frozen candidate source changed during packaging",
    );
    console.log("Frozen source bytes still match the pre-build identity");
    process.exit(0);
  }
  const candidate = validateCandidate(JSON.parse(readFileSync(process.argv[2], "utf8")));
  const root = process.cwd();
  const git = (...args) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8", windowsHide: true });
  assert.equal(git("rev-parse", "HEAD").trim(), candidate.sha, "Candidate checkout changed");
  assert.equal(git("status", "--porcelain").trim(), "", "Candidate source must start clean");
  const before = Object.fromEntries(
    versionFiles.map((file) => [file, readFileSync(path.join(root, file), "utf8")]),
  );
  const overlay = versionOverlay(before, candidate);
  for (const file of versionFiles)
    if (before[file] !== overlay[file]) writeFileSync(path.join(root, file), overlay[file]);
  const identity = await captureBuildIdentity({
    sourceRoot: root,
    frozenRoot: root,
    buildId: `candidate-${candidate.receiptSha256.slice(0, 24)}`,
    version: candidate.version,
    channel: candidate.channel,
    mode: "release-candidate",
  });
  assert(
    identity.dirtyPaths.every((entry) => versionFiles.includes(entry.path)),
    "Unexpected source changed during version preparation",
  );
  // Signed channels keep the checked-in latest.json feed. The app adds the preview feed
  // at runtime when the user picks the preview channel (src-tauri/src/app_update.rs), so a
  // preview install can return to stable. Nightly never updates itself.
  const config = {
    version: candidate.version,
    bundle: { createUpdaterArtifacts: isSignedChannel(candidate.channel) },
    ...(isSignedChannel(candidate.channel) ? {} : { plugins: { updater: { endpoints: [] } } }),
  };
  writeFileSync("temp/release-channel.json", JSON.stringify(config));
  console.log(
    `Prepared ${candidate.channel} ${candidate.version}; source SHA ${candidate.sha}; metadata-only overlay recorded`,
  );
}
