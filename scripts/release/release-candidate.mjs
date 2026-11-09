/** Exact-source CI receipts; no publishing, signing or service mutations. */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const shaPattern = /^[a-f0-9]{40}$/;
export const CHANNELS = ["stable", "preview", "nightly"];
/** Channels whose packages carry Tauri updater signatures and an updater feed. */
export const isSignedChannel = (channel) => channel === "stable" || channel === "preview";
export const PREVIEW_FEED_TAG = "updater-feed";
export const PREVIEW_FEED_ASSET = "preview.json";
export const previewFeedUrl = (repository) =>
  `https://github.com/${repository}/releases/download/${PREVIEW_FEED_TAG}/${PREVIEW_FEED_ASSET}`;
const isReleaseBranch = (branch) => /^release\/[\w.-]+$/.test(branch ?? "");

/**
 * Every channel needs the full CI aggregate `Check` at the exact source SHA. Stable and
 * nightly accept main, a release/* branch or a manual dispatch; preview accepts only main.
 */
export function selectSourceCheck({ sha, repository, runs, jobsByRun, channel = "stable" }) {
  if (!shaPattern.test(sha)) throw new Error("A full lowercase source SHA is required");
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository)) throw new Error("Invalid repository");
  const preview = channel === "preview";
  const eligible = runs
    .filter(
      (run) =>
        run.head_sha === sha &&
        (preview
          ? ["push", "workflow_dispatch"].includes(run.event) && run.head_branch === "main"
          : run.event === "workflow_dispatch" ||
            (run.event === "push" &&
              (run.head_branch === "main" || isReleaseBranch(run.head_branch)))) &&
        run.status === "completed" &&
        run.conclusion === "success" &&
        run.repository?.full_name?.toLowerCase() === repository.toLowerCase() &&
        run.path === ".github/workflows/ci.yml" &&
        Number.isSafeInteger(run.id) &&
        run.id > 0,
    )
    .sort((a, b) => b.id - a.id);
  for (const run of eligible) {
    const jobs = jobsByRun[run.id] ?? [];
    const checks = jobs.filter((job) => job.name === "Check");
    if (
      checks.length !== 1 ||
      checks[0].status !== "completed" ||
      checks[0].conclusion !== "success" ||
      checks[0].run_id !== run.id ||
      checks[0].run_attempt !== run.run_attempt ||
      checks[0].head_sha !== sha ||
      !Number.isSafeInteger(run.run_attempt) ||
      run.run_attempt < 1 ||
      !Number.isSafeInteger(checks[0].id) ||
      checks[0].id < 1 ||
      run.html_url !== `https://github.com/${repository}/actions/runs/${run.id}`
    )
      continue;
    return { runId: run.id, runAttempt: run.run_attempt, url: run.html_url, jobId: checks[0].id };
  }
  throw new Error(
    preview
      ? "No successful full main CI with aggregate Check at this exact preview source SHA"
      : "No successful full main/release/manual CI with aggregate Check at this exact source SHA",
  );
}

export function channelVersion(baseVersion, channel, sequence, sha) {
  if (!/^\d+\.\d+\.\d+$/.test(baseVersion) || !CHANNELS.includes(channel))
    throw new Error("Invalid channel version input");
  if (channel === "stable") return baseVersion;
  if (!Number.isSafeInteger(sequence) || sequence < 1 || !shaPattern.test(sha))
    throw new Error("Prereleases require an immutable sequence and source SHA");
  // Preview updates must sort above the stable release they follow: 0.7.5 -> 0.7.6-preview.N.
  const [major, minor, patch] = baseVersion.split(".").map(Number);
  const base = channel === "preview" ? `${major}.${minor}.${patch + 1}` : baseVersion;
  // "g" keeps an all-digit SHA prefix such as 012… a valid semver identifier.
  return `${base}-${channel}.${sequence}.g${sha.slice(0, 12)}`;
}

/** Orders `X.Y.Z` and `X.Y.Z-<channel>.<sequence>.g<sha12>`; other shapes are rejected. */
export function compareChannelVersions(a, b) {
  const parse = (value) => {
    const match = /^(\d+)\.(\d+)\.(\d+)(?:-[a-z]+\.(\d+)\.g[a-f0-9]{12})?$/.exec(value ?? "");
    if (!match) throw new Error(`Unsupported channel version: ${value}`);
    // A release sorts after every prerelease of the same core version.
    return [...match.slice(1, 4).map(Number), match[4] ? Number(match[4]) : Infinity];
  };
  const left = parse(a),
    right = parse(b);
  for (let index = 0; index < left.length; index++)
    if (left[index] !== right[index]) return left[index] < right[index] ? -1 : 1;
  return 0;
}

export function createCandidate({
  sha,
  repository,
  version,
  channel = "stable",
  check,
  sequence = check?.runId,
}) {
  if (!shaPattern.test(sha) || !/^[\w.-]+\/[\w.-]+$/.test(repository))
    throw new Error("Invalid source identity");
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error("Expected a numeric product version");
  if (!CHANNELS.includes(channel)) throw new Error("Unknown release channel");
  if (
    !Number.isSafeInteger(check?.runId) ||
    check.runId <= 0 ||
    !Number.isSafeInteger(check?.jobId) ||
    check.jobId <= 0
  )
    throw new Error("Successful source check receipt is required");
  if (
    !Number.isSafeInteger(check.runAttempt) ||
    check.runAttempt < 1 ||
    check.url !== `https://github.com/${repository}/actions/runs/${check.runId}`
  )
    throw new Error("Incomplete source-check receipt");
  const receipt = {
    schemaVersion: 1,
    repository,
    sha,
    sourceVersion: version,
    version: channelVersion(version, channel, sequence, sha),
    channel,
    sequence: channel === "stable" ? null : sequence,
    updaterPolicy:
      channel === "stable" ? "stable-feed" : channel === "preview" ? "preview-feed" : "disabled",
    sourceCheck: {
      runId: check.runId,
      runAttempt: check.runAttempt,
      url: check.url,
      jobId: check.jobId,
    },
    scope:
      "Exact-source CI only; binary build, package smoke, signing, installation and publication are separate.",
  };
  return {
    ...receipt,
    receiptSha256: createHash("sha256").update(JSON.stringify(receipt)).digest("hex"),
  };
}

export function validateCandidate(value) {
  if (!value || typeof value !== "object") throw new Error("Missing candidate");
  const rebuilt = createCandidate({
    sha: value.sha,
    repository: value.repository,
    version: value.sourceVersion,
    channel: value.channel,
    check: value.sourceCheck,
    sequence: value.sequence,
  });
  if (
    JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(Object.keys(rebuilt).sort()) ||
    JSON.stringify(value) !== JSON.stringify(rebuilt)
  )
    throw new Error("Candidate metadata or digest differs from its immutable source receipt");
  return value;
}

export function selectNightlySource({
  repository,
  runs,
  jobsByRun,
  previous,
  now = Date.now(),
  force = false,
  minimumGapMs = 6 * 60 * 60 * 1000,
}) {
  for (const run of [...runs].sort((a, b) => b.id - a.id)) {
    if (run.event !== "push" || run.head_branch !== "main" || !shaPattern.test(run.head_sha ?? ""))
      continue;
    let check;
    try {
      check = selectSourceCheck({ sha: run.head_sha, repository, runs: [run], jobsByRun });
    } catch {
      continue;
    }
    if (!force && previous) {
      if (!shaPattern.test(previous.sha ?? "") || !Number.isFinite(Date.parse(previous.createdAt)))
        throw new Error("Invalid previous nightly identity");
      if (previous.sha === run.head_sha) return null;
      if (now - Date.parse(previous.createdAt) < minimumGapMs) return null;
    }
    return { sha: run.head_sha, check };
  }
  throw new Error("No successful full main CI is eligible for a nightly");
}

export function validatePrHead(pull, expected) {
  if (
    !/^[\w.-]+\/[\w.-]+$/.test(expected.repository) ||
    !Number.isSafeInteger(expected.number) ||
    expected.number < 1 ||
    !shaPattern.test(expected.sha ?? "")
  )
    throw new Error("Invalid PR identity");
  if (
    pull?.state !== "open" ||
    pull.number !== expected.number ||
    pull.base?.repo?.full_name !== expected.repository ||
    pull.head?.sha !== expected.sha ||
    !/^[\w.-]+\/[\w.-]+$/.test(pull.head?.repo?.full_name ?? "")
  )
    throw new Error("PR is closed, stale, foreign or missing its immutable head");
  return {
    repository: expected.repository,
    number: expected.number,
    sha: expected.sha,
    headRepository: pull.head.repo.full_name,
  };
}

export async function api(token, route) {
  const response = await fetch(`https://api.github.com/${route}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`GitHub source-check request failed: HTTP ${response.status}`);
  return response.json();
}
async function sourceVersion({ sha, repository, token, request }) {
  const source = await request(token, `repos/${repository}/contents/package.json?ref=${sha}`);
  if (
    source.type !== "file" ||
    source.encoding !== "base64" ||
    typeof source.content !== "string" ||
    !Number.isSafeInteger(source.size) ||
    source.size <= 0 ||
    source.size > 1024 * 1024
  )
    throw new Error("Invalid source manifest");
  return JSON.parse(Buffer.from(source.content, "base64").toString("utf8")).version;
}

/** Receipt for the preview run that is executing now; its gate job must already be green. */
export async function verifySourceCandidate({
  sha,
  repository,
  token,
  channel = "stable",
  sequence,
  request = api,
}) {
  if (!shaPattern.test(sha ?? "") || !/^[\w.-]+\/[\w.-]+$/.test(repository ?? ""))
    throw new Error("Invalid candidate source");
  const version = await sourceVersion({ sha, repository, token, request });
  const runs = [];
  for (let page = 1; page <= 10; page++) {
    const data = await request(
      token,
      `repos/${repository}/actions/workflows/ci.yml/runs?head_sha=${sha}&status=success&per_page=100&page=${page}`,
    );
    if (!Array.isArray(data.workflow_runs)) throw new Error("Malformed CI run response");
    runs.push(...data.workflow_runs);
    if (data.workflow_runs.length < 100) break;
    if (page === 10) throw new Error("CI runs pagination exceeded the validation bound");
  }
  const jobsByRun = {};
  for (const run of runs
    .filter((run) => run.head_sha === sha && run.conclusion === "success")
    .sort((a, b) => b.id - a.id)
    .slice(0, 10)) {
    const jobs = [];
    for (let page = 1; page <= 10; page++) {
      const data = await request(
        token,
        `repos/${repository}/actions/runs/${run.id}/attempts/${run.run_attempt}/jobs?per_page=100&page=${page}`,
      );
      if (!Array.isArray(data.jobs)) throw new Error("Malformed CI jobs response");
      jobs.push(...data.jobs);
      if (data.jobs.length < 100) break;
      if (page === 10) throw new Error("CI jobs pagination exceeded the validation bound");
    }
    jobsByRun[run.id] = jobs;
  }
  const check = selectSourceCheck({ sha, repository, runs, jobsByRun, channel });
  return createCandidate({
    sha,
    repository,
    version,
    channel,
    check,
    sequence: sequence ?? check.runId,
  });
}

async function verify() {
  const sha = process.env.RELEASE_SOURCE_SHA || process.env.GITHUB_SHA;
  const repository = process.env.GITHUB_REPOSITORY;
  const token = process.env.GH_TOKEN;
  if (!token || !shaPattern.test(sha ?? "") || !/^[\w.-]+\/[\w.-]+$/.test(repository ?? ""))
    throw new Error("Missing source-check environment");
  const actual = execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
    windowsHide: true,
  }).trim();
  if (!process.env.RELEASE_SOURCE_SHA && actual !== sha)
    throw new Error("Checkout differs from release source");
  const { version } = JSON.parse(readFileSync("package.json", "utf8"));
  if (!process.env.RELEASE_SOURCE_SHA && process.env.GITHUB_REF !== `refs/tags/v${version}`)
    throw new Error("Release ref and product version differ");
  const candidate = await verifySourceCandidate({
    sha,
    repository,
    token,
    channel: process.env.RELEASE_CHANNEL ?? "stable",
    ...(process.env.RELEASE_SOURCE_SHA ? { sequence: Number(process.env.GITHUB_RUN_ID) } : {}),
  });
  if (!process.env.RELEASE_SOURCE_SHA && candidate.version !== version)
    throw new Error("Checked source manifest differs from tag checkout");
  const output = "temp/test-results/release-candidate/candidate.json";
  mkdirSync(path.dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify(candidate, null, 2)}\n`);
  if (process.env.GITHUB_OUTPUT) {
    const { appendFileSync } = await import("node:fs");
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `sha=${candidate.sha}\nversion=${candidate.version}\nchannel=${candidate.channel}\ndigest=${candidate.receiptSha256}\n`,
    );
  }
  console.log(
    `Source candidate ${sha}: CI run ${candidate.sourceCheck.runId}, aggregate Check passed.`,
  );
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  verify().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
