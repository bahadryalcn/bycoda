import assert from "node:assert/strict";
import { test } from "node:test";
import { createCandidate, selectSourceCheck } from "./release-candidate.mjs";

const sha = "a".repeat(40);
const repository = "owner/project";
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
const jobs = [
  {
    id: 34,
    run_id: 12,
    run_attempt: 1,
    head_sha: sha,
    name: "Check",
    status: "completed",
    conclusion: "success",
  },
];
const select = (runs = [run], items = jobs) =>
  selectSourceCheck({ sha, repository, runs, jobsByRun: { 12: items } });

test("accepts only successful full main CI and binds its exact source receipt", () => {
  const check = select();
  const receipt = createCandidate({ sha, repository, version: "0.6.94", check });
  assert.equal(receipt.sha, sha);
  assert.equal(receipt.sourceCheck.runId, 12);
  assert.equal(receipt.receiptSha256.length, 64);
  assert.notEqual(
    receipt.receiptSha256,
    createCandidate({ sha, repository, version: "0.6.95", check }).receiptSha256,
  );
});

test("an explicitly dispatched full CI can qualify an exact release-branch candidate", () => {
  assert.equal(
    select([{ ...run, event: "workflow_dispatch", head_branch: "release/0.6.94" }]).runId,
    12,
  );
});

test("rejects wrong SHA/repo/event/branch/workflow and unfinished or failed CI", () => {
  for (const patch of [
    { head_sha: "b".repeat(40) },
    { repository: { full_name: "other/project" } },
    { event: "pull_request" },
    { head_branch: "feature" },
    { path: ".github/workflows/preview.yml" },
    { status: "in_progress" },
    { conclusion: "cancelled" },
  ])
    assert.throws(() => select([{ ...run, ...patch }]));
  assert.throws(() => select([]));
});

test("a green workflow without exactly one successful aggregate Check is insufficient", () => {
  for (const conclusion of ["failure", "cancelled", "skipped", null])
    assert.throws(() => select([run], [{ ...jobs[0], conclusion }]));
  assert.throws(() => select([run], []));
  assert.throws(() => select([run], [...jobs, ...jobs]));
});

test("fails malformed candidates and keeps channel-specific receipts distinct", () => {
  const check = select();
  assert.throws(() => createCandidate({ sha: "main", repository, version: "0.6.94", check }));
  assert.throws(() => createCandidate({ sha, repository, version: "0.6.94", check: null }));
  assert.throws(() =>
    createCandidate({ sha, repository, version: "0.6.94", channel: "anything", check }),
  );
  assert.notEqual(
    createCandidate({ sha, repository, version: "0.6.94", check }).receiptSha256,
    createCandidate({ sha, repository, version: "0.6.94", channel: "preview", check })
      .receiptSha256,
  );
});
