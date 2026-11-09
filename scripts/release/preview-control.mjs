/** Default-branch validator: PR artifacts are bounded data, never executable. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { api, validatePrHead } from "./release-candidate.mjs";
export function previewIdentity(run, artifacts, repository) {
  assert(
    run?.repository?.full_name === repository &&
      run.path === ".github/workflows/pr-preview.yml" &&
      run.event === "pull_request" &&
      run.status === "completed" &&
      run.conclusion === "success" &&
      Number.isSafeInteger(run.id) &&
      run.id > 0 &&
      /^[a-f0-9]{40}$/.test(run.head_sha ?? ""),
    "Untrusted preview producer",
  );
  assert(
    Array.isArray(artifacts) && artifacts.length === 1,
    "Expected exactly one bounded preview artifact",
  );
  const artifact = artifacts[0],
    match = /^unsigned-pr-preview-([1-9]\d*)-([a-f0-9]{40})$/.exec(artifact.name ?? "");
  assert(
    match &&
      match[2] === run.head_sha &&
      !artifact.expired &&
      Number.isSafeInteger(artifact.id) &&
      artifact.id > 0 &&
      Number.isSafeInteger(artifact.size_in_bytes) &&
      artifact.size_in_bytes > 0 &&
      artifact.size_in_bytes <= 129 * 1024 * 1024,
    "Malformed, stale or oversized preview artifact",
  );
  const number = Number(match[1]);
  assert(Number.isSafeInteger(number), "Invalid preview PR number");
  if (run.pull_requests?.length)
    assert(
      run.pull_requests.some((pull) => pull.number === number && pull.head?.sha === run.head_sha),
      "Preview PR metadata differs",
    );
  return { repository, number, sha: run.head_sha, artifactId: artifact.id, runId: run.id };
}
async function download(token, repository, id, output) {
  const redirect = await fetch(
    `https://api.github.com/repos/${repository}/actions/artifacts/${id}/zip`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      redirect: "manual",
      signal: AbortSignal.timeout(30000),
    },
  );
  assert.equal(redirect.status, 302, "Expected signed artifact download URL");
  const location = new URL(redirect.headers.get("location"));
  assert(
    location.protocol === "https:" && !location.username && !location.password,
    "Unsafe artifact redirect",
  );
  // Never forward the repository token to the storage redirect.
  const response = await fetch(location, { signal: AbortSignal.timeout(60000) });
  assert(response.ok && response.body, "Artifact download failed");
  const chunks = [];
  let bytes = 0;
  for await (const chunk of response.body) {
    bytes += chunk.length;
    assert(bytes <= 129 * 1024 * 1024, "Artifact envelope exceeds bound");
    chunks.push(chunk);
  }
  writeFileSync(output, Buffer.concat(chunks), { flag: "wx" });
}
async function main() {
  const repository = process.env.GITHUB_REPOSITORY,
    token = process.env.GH_TOKEN,
    id = process.env.PREVIEW_RUN_ID;
  assert(
    /^[\w.-]+\/[\w.-]+$/.test(repository ?? "") && /^[1-9]\d*$/.test(id ?? "") && token,
    "Invalid trusted preview context",
  );
  const run = await api(token, `repos/${repository}/actions/runs/${id}`);
  const data = await api(token, `repos/${repository}/actions/runs/${id}/artifacts?per_page=100`);
  const identity = previewIdentity(run, data.artifacts, repository);
  const current = async () => {
    const pull = await api(token, `repos/${repository}/pulls/${identity.number}`);
    validatePrHead(pull, identity);
    assert.equal(pull.base.ref, "main");
    assert(
      pull.labels?.some((label) => label.name === "bycoda:preview"),
      "Owner preview label was removed",
    );
  };
  await current();
  mkdirSync("temp/pr-preview-input", { recursive: true });
  mkdirSync("temp/pr-preview-validated", { recursive: true });
  const envelope = "temp/pr-preview-input/envelope.zip",
    archive = "temp/pr-preview-validated/preview.zip";
  await download(token, repository, identity.artifactId, envelope);
  execFileSync(
    process.platform === "win32" ? "python" : "python3",
    [
      "-B",
      "scripts/release/preview-archive.py",
      envelope,
      "--artifact-envelope",
      "--preview-output",
      archive,
      "--repository",
      repository,
      "--pull",
      String(identity.number),
      "--sha",
      identity.sha,
      "--output",
      "temp/pr-preview-validated/validation.json",
    ],
    { windowsHide: true, stdio: "inherit", timeout: 60000 },
  );
  await current();
  writeFileSync(
    "temp/pr-preview-validated/producer.json",
    `${JSON.stringify(identity, null, 2)}\n`,
    { flag: "wx" },
  );
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
