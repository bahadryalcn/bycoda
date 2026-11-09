/** Trusted workflow controls: API data only, no PR code execution. */
import assert from "node:assert/strict";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  api,
  selectNightlySource,
  validatePrHead,
  verifySourceCandidate,
} from "./release-candidate.mjs";

export async function nightlySource({ repository, token, force = false, request = api }) {
  const data = await request(
    token,
    `repos/${repository}/actions/workflows/ci.yml/runs?branch=main&event=push&status=success&per_page=100`,
  );
  assert(
    Array.isArray(data.workflow_runs) && data.workflow_runs.length <= 100,
    "Malformed nightly CI selection",
  );
  const jobsByRun = {};
  for (const run of data.workflow_runs.slice(0, 20)) {
    const response = await request(
      token,
      `repos/${repository}/actions/runs/${run.id}/attempts/${run.run_attempt}/jobs?per_page=100`,
    );
    assert(
      Array.isArray(response.jobs) && response.jobs.length < 100,
      "Unbounded or malformed nightly job metadata",
    );
    jobsByRun[run.id] = response.jobs;
  }
  const releases = await request(token, `repos/${repository}/releases?per_page=100`);
  assert(Array.isArray(releases), "Malformed nightly history");
  const release = releases.find((entry) => /^v\d+\.\d+\.\d+-nightly\./.test(entry.tag_name));
  let previous = release ? { sha: release.target_commitish, createdAt: release.created_at } : null;
  // Unpublished successful candidate artifacts also count as nightly history.
  const history = await request(
    token,
    `repos/${repository}/actions/workflows/nightly-candidate.yml/runs?status=success&per_page=20`,
  );
  assert(
    Array.isArray(history.workflow_runs) && history.workflow_runs.length <= 20,
    "Malformed nightly candidate history",
  );
  for (const run of history.workflow_runs) {
    if (
      String(run.id) === process.env.GITHUB_RUN_ID ||
      run.status !== "completed" ||
      run.conclusion !== "success" ||
      run.head_branch !== "main" ||
      !["schedule", "workflow_dispatch"].includes(run.event) ||
      run.repository?.full_name !== repository
    )
      continue;
    const artifacts = await request(
      token,
      `repos/${repository}/actions/runs/${run.id}/artifacts?per_page=100`,
    );
    assert(
      Array.isArray(artifacts.artifacts) && artifacts.artifacts.length < 100,
      "Unbounded nightly artifact history",
    );
    const receipts = artifacts.artifacts.filter(
      (entry) => /^release-candidate-[a-f0-9]{40}$/.test(entry.name) && !entry.expired,
    );
    if (receipts.length !== 1) continue;
    const item = {
      sha: receipts[0].name.slice("release-candidate-".length),
      createdAt: run.created_at,
    };
    if (!previous || Date.parse(item.createdAt) > Date.parse(previous.createdAt)) previous = item;
    break;
  }
  return selectNightlySource({
    repository,
    runs: data.workflow_runs,
    jobsByRun,
    force,
    ...(previous ? { previous } : {}),
  });
}

const command = process.argv[2];
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const repository = process.env.GITHUB_REPOSITORY,
    token = process.env.GH_TOKEN;
  assert(/^[\w.-]+\/[\w.-]+$/.test(repository ?? "") && token, "Missing workflow API context");
  const output = (values) => {
    if (process.env.GITHUB_OUTPUT)
      appendFileSync(
        process.env.GITHUB_OUTPUT,
        Object.entries(values)
          .map(([key, value]) => `${key}=${value}`)
          .join("\n") + "\n",
      );
  };
  if (["resolve-pr", "check-pr"].includes(command)) {
    const number = Number(process.env.PREVIEW_PULL_NUMBER);
    assert(Number.isSafeInteger(number) && number > 0, "A PR number is required");
    const pull = await api(token, `repos/${repository}/pulls/${number}`);
    const identity = validatePrHead(pull, {
      repository,
      number,
      sha: process.env.PREVIEW_SOURCE_SHA || pull.head?.sha,
    });
    output({ sha: identity.sha, head_repository: identity.headRepository, pull_number: number });
    console.log(JSON.stringify(identity));
  } else if (command === "create" || command === "preview") {
    const channel = command === "preview" ? "preview" : (process.env.RELEASE_CHANNEL ?? "nightly");
    let sha = process.env.RELEASE_SOURCE_SHA;
    if (!sha && channel === "nightly") {
      const selected = await nightlySource({
        repository,
        token,
        force: process.env.NIGHTLY_FORCE === "true",
      });
      if (!selected) {
        output({ should_build: "false" });
        process.exit(0);
      }
      sha = selected.sha;
    }
    // Preview builds the commit whose CI just passed (RELEASE_SOURCE_SHA), never the tip.
    const candidate = await verifySourceCandidate({
      sha,
      repository,
      token,
      channel,
      sequence: Number(process.env.GITHUB_RUN_ID),
    });
    const file = "temp/test-results/release-candidate/candidate.json";
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify(candidate, null, 2)}\n`, { flag: "wx" });
    output({
      should_build: "true",
      sha: candidate.sha,
      version: candidate.version,
      channel: candidate.channel,
      digest: candidate.receiptSha256,
    });
    console.log(
      `Immutable ${candidate.channel} candidate ${candidate.version} at ${candidate.sha}`,
    );
  } else throw new Error("Unknown trusted candidate control");
}
