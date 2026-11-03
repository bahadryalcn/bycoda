import assert from "node:assert/strict";
import { test } from "node:test";
import {
  channelVersion,
  createCandidate,
  selectNightlySource,
  validateCandidate,
  validatePrHead,
} from "./release-candidate.mjs";
import { validateProducerRun, revalidateSource } from "./publish-candidate.mjs";
import { previewIdentity } from "./preview-control.mjs";
import { nightlySource } from "./candidate-control.mjs";
import { versionOverlay } from "./prepare-candidate.mjs";
const sha = "a".repeat(40),
  repository = "owner/project";
const run = {
  id: 12,
  run_attempt: 1,
  head_sha: sha,
  event: "push",
  status: "completed",
  conclusion: "success",
  repository: { full_name: repository },
  head_branch: "main",
  path: ".github/workflows/ci.yml",
  html_url: "https://github.com/owner/project/actions/runs/12",
};
const jobsByRun = {
  12: [
    {
      id: 34,
      run_id: 12,
      run_attempt: 1,
      head_sha: sha,
      name: "Check",
      status: "completed",
      conclusion: "success",
    },
  ],
};
const check = { runId: 12, runAttempt: 1, jobId: 34, url: run.html_url };
test("channels have immutable distinct versions and preview never uses stable updater policy", () => {
  assert.equal(
    channelVersion("0.6.94", "nightly", 42, sha),
    `0.6.94-nightly.42.${sha.slice(0, 12)}`,
  );
  const candidate = createCandidate({
    sha,
    repository,
    version: "0.6.94",
    channel: "preview",
    check,
    sequence: 42,
  });
  assert.equal(candidate.updaterPolicy, "disabled");
  assert.equal(validateCandidate(JSON.parse(JSON.stringify(candidate))).version, candidate.version);
  for (const mutation of [
    { sha: "b".repeat(40) },
    { version: "0.6.94" },
    { channel: "stable" },
    { updaterPolicy: "stable-feed" },
    { receiptSha256: "0".repeat(64) },
  ])
    assert.throws(() => validateCandidate({ ...candidate, ...mutation }));
  assert.throws(() => channelVersion("0.6.94", "preview", 0, sha));
});
test("nightly selection rejects incomplete CI and observes source/change/time gates", () => {
  const input = { repository, runs: [run], jobsByRun };
  assert.equal(selectNightlySource(input).sha, sha);
  assert.equal(
    selectNightlySource({ ...input, previous: { sha, createdAt: new Date().toISOString() } }),
    null,
  );
  assert.equal(
    selectNightlySource({
      ...input,
      previous: { sha: "b".repeat(40), createdAt: new Date().toISOString() },
    }),
    null,
  );
  assert.equal(
    selectNightlySource({
      ...input,
      force: true,
      previous: { sha, createdAt: new Date().toISOString() },
    }).sha,
    sha,
  );
  assert.throws(() => selectNightlySource({ ...input, jobsByRun: {} }));
  assert.throws(() =>
    selectNightlySource({ ...input, previous: { sha: "main", createdAt: "unknown" } }),
  );
  assert.throws(() => selectNightlySource({ ...input, runs: [{ ...run, event: "pull_request" }] }));
});
test("PR preview admission requires current open exact head; producer trust is separate", () => {
  const expected = { repository, number: 7, sha },
    pull = {
      state: "open",
      number: 7,
      base: { repo: { full_name: repository } },
      head: { sha, repo: { full_name: "fork/project" } },
    };
  assert.equal(validatePrHead(pull, expected).headRepository, "fork/project");
  assert.throws(() => validatePrHead({ ...pull, state: "closed" }, expected));
  assert.throws(() =>
    validatePrHead({ ...pull, head: { ...pull.head, sha: "b".repeat(40) } }, expected),
  );
  assert.throws(() => validatePrHead({ ...pull, number: 8 }, expected));
  assert.throws(() =>
    validateProducerRun(
      { ...run, path: ".github/workflows/pr-preview.yml", event: "workflow_dispatch" },
      repository,
    ),
  );
  assert.throws(() =>
    validateProducerRun(
      { ...run, path: ".github/workflows/release.yml", event: "pull_request" },
      repository,
    ),
  );
  assert.throws(() =>
    validateProducerRun(
      {
        ...run,
        path: ".github/workflows/release.yml",
        head_branch: "v0.6.94",
        conclusion: "failure",
      },
      repository,
    ),
  );
});
test("ephemeral version overlays change only version-owned files and refuse unrelated versions", () => {
  const candidate = createCandidate({
    sha,
    repository,
    version: "0.6.94",
    channel: "nightly",
    check,
  });
  const source = {
    "package.json": '{"version":"0.6.94","scripts":{"build":"fixture"}}',
    "src-tauri/tauri.conf.json": '{"version":"0.6.94","identifier":"fixture"}',
    "Cargo.toml": '[workspace.package]\nversion = "0.6.94"\n',
    "Cargo.lock": '[[package]]\nname = "bycoda"\nversion = "0.6.94"\n',
  };
  const overlay = versionOverlay(source, candidate);
  assert.equal(JSON.parse(overlay["package.json"]).version, candidate.version);
  assert.equal(JSON.parse(overlay["package.json"]).scripts.build, "fixture");
  assert.equal(JSON.parse(overlay["src-tauri/tauri.conf.json"]).identifier, "fixture");
  assert(overlay["Cargo.lock"].includes(candidate.version));
  assert.throws(() =>
    versionOverlay({ ...source, "package.json": '{"version":"other"}' }, candidate),
  );
});
test("publisher rejects newer CI attempts and mismatched exact aggregate jobs", async () => {
  const candidate = createCandidate({ sha, repository, version: "0.6.94", check });
  await revalidateSource(candidate, "fixture", async (_token, route) =>
    route.endsWith("/12") ? run : { jobs: jobsByRun[12] },
  );
  await assert.rejects(() =>
    revalidateSource(candidate, "fixture", async () => ({ ...run, run_attempt: 2 })),
  );
  await assert.rejects(() =>
    revalidateSource(candidate, "fixture", async (_token, route) =>
      route.endsWith("/12") ? run : { jobs: [{ ...jobsByRun[12][0], id: 99 }] },
    ),
  );
});
test("preview validation requires PR-scoped producer and exact bounded artifact metadata", () => {
  const producer = {
    ...run,
    event: "pull_request",
    path: ".github/workflows/pr-preview.yml",
    pull_requests: [{ number: 7, head: { sha } }],
  };
  const artifact = {
    name: `unsigned-pr-preview-7-${sha}`,
    id: 14,
    expired: false,
    size_in_bytes: 100,
  };
  assert.equal(previewIdentity(producer, [artifact], repository).number, 7);
  for (const mutation of [
    { event: "workflow_dispatch" },
    { path: ".github/workflows/release.yml" },
    { conclusion: "failure" },
  ])
    assert.throws(() => previewIdentity({ ...producer, ...mutation }, [artifact], repository));
  for (const mutation of [
    { name: `unsigned-pr-preview-7-${"b".repeat(40)}` },
    { size_in_bytes: 1024 ** 3 },
    { expired: true },
  ])
    assert.throws(() => previewIdentity(producer, [{ ...artifact, ...mutation }], repository));
  assert.throws(() => previewIdentity(producer, [artifact, artifact], repository));
});
test("unpublished successful nightly artifacts suppress unchanged-source rebuilds", async () => {
  const request = async (_token, route) => {
    if (route.includes("workflows/ci.yml/runs")) return { workflow_runs: [run] };
    if (route.includes("/attempts/")) return { jobs: jobsByRun[12] };
    if (route.includes("/releases?")) return [];
    if (route.includes("workflows/nightly-candidate.yml/runs"))
      return {
        workflow_runs: [
          { ...run, id: 22, event: "schedule", created_at: new Date().toISOString() },
        ],
      };
    if (route.includes("/22/artifacts"))
      return { artifacts: [{ name: `release-candidate-${sha}`, expired: false }] };
    throw new Error(`Unexpected fixture request ${route}`);
  };
  assert.equal(await nightlySource({ repository, token: "fixture", request }), null);
  assert.equal(
    (await nightlySource({ repository, token: "fixture", request, force: true })).sha,
    sha,
  );
});
