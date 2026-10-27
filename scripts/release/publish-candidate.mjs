/** Owner-dispatched publisher. Downloaded artifacts are data, never executed. */
import assert from "node:assert/strict";
import { lstatSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { api, selectSourceCheck, validateCandidate } from "./release-candidate.mjs";
import { digest, validatePackageManifest } from "./package-manifest.mjs";
import { validateHostManifest } from "./host-manifest.mjs";
import { verifyUpdaterSignature } from "./updater-signature.mjs";
import { formatSha256Sum } from "./checksum.mjs";

export function validateProducerRun(run, repository) {
  assert(
    run?.repository?.full_name === repository &&
      run.status === "completed" &&
      run.conclusion === "success" &&
      Number.isSafeInteger(run.id) &&
      run.id > 0,
    "Producer did not complete successfully in this repository",
  );
  assert(
    [
      ".github/workflows/release.yml",
      ".github/workflows/release-candidate.yml",
      ".github/workflows/nightly-candidate.yml",
    ].includes(run.path),
    "Untrusted artifact producer workflow",
  );
  assert(
    ["push", "workflow_dispatch", "schedule"].includes(run.event),
    "PR artifacts cannot become signed release candidates",
  );
  if (run.event === "push")
    assert(/^v\d+\.\d+\.\d+$/.test(run.head_branch), "Stable producer is not a version tag");
  else
    assert(run.head_branch === "main", "Manual/scheduled producer must use trusted main tooling");
  return run;
}
export function validatePackageSet(candidate, packages) {
  validateCandidate(candidate);
  assert.equal(packages.length, 2, "Both desktop platforms are required");
  assert.deepEqual(packages.map((entry) => entry.manifest.platform).sort(), [
    "macos-arm64",
    "windows-x64",
  ]);
  for (const entry of packages) {
    validatePackageManifest(entry.manifest, entry.root, { requireSmoke: true });
    assert.equal(
      entry.manifest.source.candidateDigest,
      candidate.receiptSha256,
      "Mixed release candidates",
    );
  }
  return packages;
}
export function updaterMetadata(candidate, packages) {
  assert.equal(
    candidate.channel,
    "stable",
    "Only stable packages may produce the stable updater feed",
  );
  const platforms = {};
  for (const { manifest, root } of packages) {
    const archive = manifest.components.updaterArchive,
      signature = manifest.components.updaterSignature;
    const value = readFileSync(path.join(root, signature.path), "utf8").trim();
    assert(
      value.length > 0 && value.length <= 16384 && /^[A-Za-z0-9+/=\r\n]+$/.test(value),
      "Invalid updater signature encoding",
    );
    platforms[manifest.platform === "windows-x64" ? "windows-x86_64" : "darwin-aarch64"] = {
      signature: value,
      url: `https://github.com/${candidate.repository}/releases/download/v${candidate.version}/${path.basename(archive.path)}`,
    };
  }
  return {
    version: candidate.version,
    notes: `Candidate ${candidate.sha}`,
    pub_date: new Date(
      Math.max(...packages.map(({ manifest }) => Date.parse(manifest.smoke.completedAt))),
    ).toISOString(),
    platforms,
  };
}
export async function revalidateSource(candidate, token, request = api) {
  validateCandidate(candidate);
  const run = await request(
    token,
    `repos/${candidate.repository}/actions/runs/${candidate.sourceCheck.runId}`,
  );
  assert.equal(
    run.run_attempt,
    candidate.sourceCheck.runAttempt,
    "Source CI has a newer attempt; select a fresh candidate",
  );
  const response = await request(
    token,
    `repos/${candidate.repository}/actions/runs/${run.id}/attempts/${run.run_attempt}/jobs?per_page=100`,
  );
  assert(Array.isArray(response.jobs) && response.jobs.length < 100, "Unbounded source CI jobs");
  const check = selectSourceCheck({
    sha: candidate.sha,
    repository: candidate.repository,
    runs: [run],
    jobsByRun: { [run.id]: response.jobs },
  });
  assert.equal(check.jobId, candidate.sourceCheck.jobId, "Source CI job identity changed");
}
function readJson(file) {
  const stat = lstatSync(file);
  assert(stat.isFile() && stat.size <= 2 * 1024 * 1024, "Metadata must be bounded regular JSON");
  return JSON.parse(readFileSync(file, "utf8"));
}
async function mutate(token, route, method, body) {
  assert(["POST", "PATCH"].includes(method), "Only explicit release mutations are supported");
  const response = await fetch(`https://api.github.com/${route}`, {
    method: method === "POST" ? "POST" : "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  assert(response.ok, `Release API ${method} failed: HTTP ${response.status}`);
  return response.json();
}
async function verifyTag(token, candidate) {
  let ref = await api(token, `repos/${candidate.repository}/git/ref/tags/v${candidate.version}`);
  for (let depth = 0; ref.object?.type === "tag" && depth < 4; depth++)
    ref = await api(token, `repos/${candidate.repository}/git/tags/${ref.object.sha}`);
  assert(
    ref.object?.type === "commit" && ref.object.sha === candidate.sha,
    "Release tag moved away from candidate source",
  );
}
async function ensureTag(token, candidate) {
  const refs = await api(
    token,
    `repos/${candidate.repository}/git/matching-refs/tags/v${candidate.version}`,
  );
  assert(Array.isArray(refs) && refs.length < 100, "Unbounded release tag metadata");
  if (!refs.some((entry) => entry.ref === `refs/tags/v${candidate.version}`)) {
    assert(
      candidate.channel !== "stable",
      "Stable publication requires the owner-created version tag",
    );
    await mutate(token, `repos/${candidate.repository}/git/refs`, "POST", {
      ref: `refs/tags/v${candidate.version}`,
      sha: candidate.sha,
    });
  }
  await verifyTag(token, candidate);
}
async function upload(token, release, candidate, name, bytes) {
  assert(/^[A-Za-z0-9_.+-]+$/.test(name), "Invalid release asset name");
  (release.expectedAssets ??= new Set()).add(name);
  const existing = release.assets?.find((asset) => asset.name === name);
  const fingerprint = `sha256:${digest(bytes)}`;
  if (existing) {
    assert(
      existing.size === bytes.length && existing.digest === fingerprint,
      `Existing asset is immutable or has unverifiable bytes: ${name}`,
    );
    return;
  }
  const endpoint = `https://uploads.github.com/repos/${candidate.repository}/releases/${release.id}/assets?name=${encodeURIComponent(name)}`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/octet-stream" },
    body: bytes,
    signal: AbortSignal.timeout(300000),
  });
  assert(response.ok, `Asset upload failed: HTTP ${response.status}`);
  const asset = await response.json();
  assert.equal(asset.name, name, "Uploaded asset name differs");
  assert.equal(asset.size, bytes.length, "Uploaded asset size differs");
  if (asset.digest) assert.equal(asset.digest, fingerprint, "Uploaded asset digest differs");
  (release.assets ??= []).push(asset);
}
async function main() {
  const directory = process.argv[2],
    token = process.env.GH_TOKEN,
    repository = process.env.GITHUB_REPOSITORY;
  assert(
    directory && token && /^[\w.-]+\/[\w.-]+$/.test(repository ?? ""),
    "Missing publication context",
  );
  const candidate = validateCandidate(readJson(path.join(directory, "candidate.json")));
  assert.equal(candidate.repository, repository, "Foreign candidate repository");
  const producer = await api(
    token,
    `repos/${repository}/actions/runs/${process.env.CANDIDATE_RUN_ID}`,
  );
  validateProducerRun(producer, repository);
  const packages = ["windows-x64", "macos-arm64"].map((platform) => {
    const root = path.join(directory, `desktop-package-${platform}`);
    return { root, manifest: readJson(path.join(root, "manifest.json")) };
  });
  validatePackageSet(candidate, packages);
  if (candidate.channel === "stable") {
    const publicKey = readJson("src-tauri/tauri.fork.conf.json").plugins.updater.pubkey;
    for (const { manifest, root } of packages)
      verifyUpdaterSignature({
        data: readFileSync(path.join(root, manifest.components.updaterArchive.path)),
        signature: readFileSync(path.join(root, manifest.components.updaterSignature.path), "utf8"),
        publicKey,
        filename: path.basename(manifest.components.updaterArchive.path),
        version: candidate.version,
      });
  }
  const hostRoot = path.join(directory, "standalone-host-packages");
  const hosts =
    candidate.channel === "stable"
      ? validateHostManifest(
          readJson(path.join(hostRoot, "host-manifest.json")),
          hostRoot,
          candidate,
        )
      : null;
  await revalidateSource(candidate, token);
  const publish = process.env.PUBLISH_CANDIDATE === "true";
  if (publish)
    assert(
      process.env.EXPECTED_SOURCE_SHA === candidate.sha &&
        process.env.EXPECTED_VERSION === candidate.version &&
        process.env.EXPECTED_CANDIDATE_DIGEST === candidate.receiptSha256 &&
        process.env.GITHUB_EVENT_NAME === "workflow_dispatch",
      "Publishing requires explicit owner-dispatched exact candidate acknowledgement",
    );
  const releases = await api(token, `repos/${repository}/releases?per_page=100`);
  assert(Array.isArray(releases) && releases.length <= 100, "Malformed release history");
  await ensureTag(token, candidate);
  let release = releases.find((entry) => entry.tag_name === `v${candidate.version}`);
  if (!release)
    release = await mutate(token, `repos/${repository}/releases`, "POST", {
      tag_name: `v${candidate.version}`,
      target_commitish: candidate.sha,
      name: `bycoda ${candidate.version}`,
      body: `Immutable candidate ${candidate.sha}. Package smoke receipts and byte manifests accompany the assets.`,
      draft: true,
      prerelease: candidate.channel !== "stable",
      make_latest: "false",
    });
  assert(release.draft === true, "An existing public release cannot be overwritten");
  await verifyTag(token, candidate);
  for (const { manifest, root } of packages) {
    for (const file of manifest.files.filter((file) =>
      [
        "installer",
        "updaterArchive",
        "updaterSignature",
        ...(hosts ? [] : ["hostArchive"]),
      ].includes(file.role),
    )) {
      const bytes = readFileSync(path.join(root, file.path));
      await upload(token, release, candidate, path.basename(file.path), bytes);
      await upload(
        token,
        release,
        candidate,
        `${path.basename(file.path)}.sha256`,
        Buffer.from(formatSha256Sum(file.sha256, path.basename(file.path))),
      );
    }
    await upload(
      token,
      release,
      candidate,
      `desktop-manifest-${manifest.platform}.json`,
      Buffer.from(JSON.stringify(manifest, null, 2)),
    );
  }
  if (hosts) {
    for (const entry of hosts.packages)
      for (const file of [entry.archive, entry.checksum])
        await upload(
          token,
          release,
          candidate,
          file.path,
          readFileSync(path.join(hostRoot, file.path)),
        );
    await upload(
      token,
      release,
      candidate,
      "host-manifest.json",
      Buffer.from(JSON.stringify(hosts, null, 2)),
    );
  }
  await upload(
    token,
    release,
    candidate,
    "candidate.json",
    Buffer.from(JSON.stringify(candidate, null, 2)),
  );
  if (candidate.channel === "stable")
    await upload(
      token,
      release,
      candidate,
      "latest.json",
      Buffer.from(JSON.stringify(updaterMetadata(candidate, packages), null, 2)),
    );
  else
    assert(
      !release.assets?.some((asset) => /^latest.*\.json$/i.test(asset.name)),
      "Nonstable release carries updater metadata",
    );
  assert(
    Array.isArray(release.assets) &&
      release.assets.length === release.expectedAssets.size &&
      new Set(release.assets.map((asset) => asset.name)).size === release.assets.length &&
      release.assets.every((asset) => release.expectedAssets.has(asset.name)),
    "Draft contains missing, duplicate or unbound release assets",
  );
  await revalidateSource(candidate, token);
  await verifyTag(token, candidate);
  if (publish)
    await mutate(token, `repos/${repository}/releases/${release.id}`, "PATCH", {
      draft: false,
      prerelease: candidate.channel !== "stable",
      make_latest: candidate.channel === "stable" ? "true" : "false",
    });
  console.log(
    `${publish ? "Published" : "Draft prepared"}: ${candidate.version} at ${candidate.sha}`,
  );
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
