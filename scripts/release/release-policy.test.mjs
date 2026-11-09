import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  channelVersion,
  compareChannelVersions,
  createCandidate,
  previewFeedUrl,
  selectNightlySource,
  selectSourceCheck,
  validateCandidate,
  validatePrHead,
  verifySourceCandidate,
} from "./release-candidate.mjs";
import {
  previewReleasesToPrune,
  revalidateSource,
  shouldReplacePreviewFeed,
  validateProducerRun,
} from "./publish-candidate.mjs";
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
test("channels have immutable distinct versions and preview uses only its own feed", () => {
  assert.equal(
    channelVersion("0.6.94", "nightly", 42, sha),
    `0.6.94-nightly.42.g${sha.slice(0, 12)}`,
  );
  // Preview sorts above the stable release it follows, so preview installs update.
  assert.equal(
    channelVersion("0.6.94", "preview", 42, sha),
    `0.6.95-preview.42.g${sha.slice(0, 12)}`,
  );
  const candidate = createCandidate({
    sha,
    repository,
    version: "0.6.94",
    channel: "preview",
    check,
    sequence: 42,
  });
  assert.equal(candidate.updaterPolicy, "preview-feed");
  assert.equal(
    createCandidate({ sha, repository, version: "0.6.94", channel: "nightly", check, sequence: 42 })
      .updaterPolicy,
    "disabled",
  );
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
const previewRun = {
  ...run,
  id: 40,
  event: "workflow_run",
  status: "in_progress",
  conclusion: null,
  path: ".github/workflows/preview.yml",
  html_url: "https://github.com/owner/project/actions/runs/40",
};
test("preview needs full main CI with a passed Check at the exact SHA", () => {
  const select = (runPatch = {}, jobs = jobsByRun[12]) =>
    selectSourceCheck({
      sha,
      repository,
      runs: [{ ...run, ...runPatch }],
      jobsByRun: { 12: jobs },
      channel: "preview",
    });
  assert.equal(select().jobId, 34);
  assert.equal(select({ event: "workflow_dispatch" }).jobId, 34);
  for (const patch of [
    { head_branch: "feature" },
    { head_branch: "release/0.7" },
    { event: "pull_request" },
    { status: "in_progress", conclusion: null },
    { conclusion: "failure" },
    { path: ".github/workflows/preview.yml" },
    { head_sha: "b".repeat(40) },
    { repository: { full_name: "fork/project" } },
  ])
    assert.throws(() => select(patch));
  for (const conclusion of ["failure", "cancelled", null])
    assert.throws(() => select({}, [{ ...jobsByRun[12][0], conclusion }]));
});
test("stable may come from a release branch push with full CI", () => {
  const branch = { ...run, head_branch: "release/0.7" };
  assert.equal(selectSourceCheck({ sha, repository, runs: [branch], jobsByRun }).runId, 12);
  assert.throws(() =>
    selectSourceCheck({
      sha,
      repository,
      runs: [{ ...branch, head_branch: "release/../main" }],
      jobsByRun,
    }),
  );
});
test("a preview receipt binds the passed CI run and the preview run sequence", async () => {
  const request = async (_token, route) => {
    if (route.includes("workflows/ci.yml/runs")) return { workflow_runs: [run] };
    if (route.includes("/runs/12/attempts/1/jobs")) return { jobs: jobsByRun[12] };
    if (route.includes("contents/package.json"))
      return {
        type: "file",
        encoding: "base64",
        size: 20,
        content: Buffer.from('{"version":"0.7.5"}').toString("base64"),
      };
    throw new Error(`Unexpected fixture request ${route}`);
  };
  const candidate = await verifySourceCandidate({
    sha,
    repository,
    token: "fixture",
    channel: "preview",
    sequence: 40,
    request,
  });
  assert.equal(candidate.version, `0.7.6-preview.40.g${sha.slice(0, 12)}`);
  assert.equal(candidate.sourceCheck.jobId, 34);
  const failing = async (token, route) =>
    route.includes("/jobs")
      ? { jobs: [{ ...jobsByRun[12][0], conclusion: "failure" }] }
      : request(token, route);
  await assert.rejects(() =>
    verifySourceCandidate({
      sha,
      repository,
      token: "fixture",
      channel: "preview",
      sequence: 40,
      request: failing,
    }),
  );
});
test("only the running preview workflow may publish itself before completing", () => {
  assert.equal(validateProducerRun(previewRun, repository, { currentRunId: 40 }).id, 40);
  assert.throws(() => validateProducerRun(previewRun, repository));
  assert.throws(() => validateProducerRun(previewRun, repository, { currentRunId: 41 }));
  assert.throws(() =>
    validateProducerRun({ ...previewRun, head_branch: "feature" }, repository, {
      currentRunId: 40,
    }),
  );
  assert.throws(() =>
    validateProducerRun({ ...previewRun, event: "push" }, repository, { currentRunId: 40 }),
  );
  assert.throws(() =>
    validateProducerRun(
      { ...previewRun, path: ".github/workflows/release-candidate.yml" },
      repository,
      { currentRunId: 40 },
    ),
  );
});
test("channel versions order releases after their prereleases and runs numerically", () => {
  const p = (n) => `0.7.6-preview.${n}.g${sha.slice(0, 12)}`;
  assert.equal(compareChannelVersions("0.7.5", p(9)), -1);
  assert.equal(compareChannelVersions("0.7.6", p(9)), 1);
  assert.equal(compareChannelVersions(p(10), p(9)), 1);
  assert.equal(compareChannelVersions("0.10.0", "0.9.9"), 1);
  assert.throws(() => compareChannelVersions("latest", "0.7.6"));
});
test("the app reads the same preview feed the publisher writes", () => {
  const source = readFileSync(
    new URL("../../src-tauri/src/app_update.rs", import.meta.url),
    "utf8",
  );
  const config = JSON.parse(
    readFileSync(new URL("../../src-tauri/tauri.conf.json", import.meta.url), "utf8"),
  );
  const [, stableRepository] = /github\.com\/([\w.-]+\/[\w.-]+)\/releases\/latest\//.exec(
    config.plugins.updater.endpoints[0],
  );
  assert(source.includes(`"${previewFeedUrl(stableRepository)}"`));
});
test("the preview feed only moves forward", () => {
  const p = (n) => `0.7.6-preview.${n}.g${sha.slice(0, 12)}`;
  assert.equal(shouldReplacePreviewFeed(null, p(9)), true);
  assert.equal(shouldReplacePreviewFeed({ version: p(9) }, p(10)), true);
  assert.equal(shouldReplacePreviewFeed({ version: p(10) }, p(9)), false);
  assert.equal(shouldReplacePreviewFeed({ version: p(10) }, p(10)), false);
  assert.equal(shouldReplacePreviewFeed({ version: "garbage" }, p(10)), true);
});
test("pruning keeps the newest published previews and never touches other releases", () => {
  const release = (n, patch = {}) => ({
    id: n,
    tag_name: `v0.7.6-preview.${n}.g${sha.slice(0, 12)}`,
    draft: false,
    prerelease: true,
    ...patch,
  });
  const releases = [
    ...Array.from({ length: 13 }, (_, index) => release(index + 1)),
    { id: 100, tag_name: "v0.7.5", draft: false, prerelease: false },
    { id: 101, tag_name: "updater-feed", draft: false, prerelease: true },
    release(102, { draft: true }),
    { id: 103, tag_name: `v0.7.6-nightly.1.g${sha.slice(0, 12)}`, draft: false, prerelease: true },
  ];
  assert.deepEqual(
    previewReleasesToPrune(releases, 10).map((entry) => entry.id),
    [3, 2, 1],
  );
  assert.deepEqual(previewReleasesToPrune(releases.slice(0, 5), 10), []);
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
