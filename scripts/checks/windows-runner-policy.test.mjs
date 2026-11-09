import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  selectWindowsRunner,
  windowsHeavyConcurrencyGroup,
  windowsSelfHostedLabels,
} from "./windows-runner-policy.mjs";
import { windowsContext } from "./windows-runner-policy-fixtures.mjs";
test("disabled and malformed flags retain hosted Windows without trusting optional metadata", () => {
  for (const enabled of [undefined, false, true, "false", "True", "TRUE", "1", 1, " true"])
    assert.deepEqual(selectWindowsRunner({ enabled, ...windowsContext() }), {
      selfHosted: false,
      runsOn: "windows-latest",
      concurrencyGroup: "",
      reason: "opt-in-disabled",
    });
  assert.equal(selectWindowsRunner({ enabled: "true" }).runsOn, "windows-latest");
});
test("only trusted exact source/ref/workflow contexts opt into isolated Windows", () => {
  for (const input of [windowsContext(), windowsContext({ eventName: "workflow_dispatch" })]) {
    const route = selectWindowsRunner({ enabled: "true", ...input });
    assert.equal(route.selfHosted, true);
    assert.deepEqual(route.runsOn, windowsSelfHostedLabels);
    assert.equal(route.concurrencyGroup, windowsHeavyConcurrencyGroup);
  }
  const base = windowsContext();
  const mutations = [
    {
      eventName: "pull_request",
      event: { ...base.event, pull_request: { head: { repo: base.event.repository } } },
    },
    {
      eventName: "pull_request",
      event: { ...base.event, pull_request: { head: { repo: { full_name: "fork/bycoda" } } } },
    },
    { eventName: "pull_request_target" },
    { eventName: "workflow_run" },
    { eventName: "schedule" },
    { eventName: "workflow_call" },
    { repository: "fork/bycoda" },
    { repositoryId: "1" },
    { event: { ...base.event, repository: { ...base.event.repository, id: 1 } } },
    { ref: "refs/heads/feature" },
    { refType: "tag" },
    { defaultBranch: "feature" },
    { sha: "abc" },
    { workflowSha: "b".repeat(40) },
    { workflowRef: "fork/bycoda/.github/workflows/ci.yml@refs/heads/main" },
    { workflowRef: "bahadryalcn/bycoda/.github/workflows/ci.yml@refs/pull/7/merge" },
    { event: { ...base.event, after: "b".repeat(40) } },
    { event: { ...base.event, deleted: true } },
    { scope: "package" },
    { scope: "unknown" },
  ];
  for (const mutation of mutations)
    assert.equal(
      selectWindowsRunner({ ...base, ...mutation, enabled: "true" }).selfHosted,
      false,
      JSON.stringify(mutation),
    );
});
test("CLI emits the hosted fallback and exact opt-in labels through GitHub outputs", (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "bycoda-windows-route-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const eventFile = path.join(root, "event.json"),
    output = path.join(root, "output");
  const input = windowsContext();
  writeFileSync(eventFile, JSON.stringify(input.event));
  const env = {
    ...process.env,
    WINDOWS_SELF_HOSTED_OPT_IN: "true",
    GITHUB_EVENT_PATH: eventFile,
    GITHUB_OUTPUT: output,
    GITHUB_EVENT_NAME: input.eventName,
    GITHUB_REPOSITORY: input.repository,
    GITHUB_REPOSITORY_ID: input.repositoryId,
    GITHUB_REF: input.ref,
    GITHUB_REF_TYPE: input.refType,
    GITHUB_SHA: input.sha,
    GITHUB_WORKFLOW_SHA: input.workflowSha,
    GITHUB_WORKFLOW_REF: input.workflowRef,
    GITHUB_RUN_ID: input.runId,
    GITHUB_RUN_ATTEMPT: input.runAttempt,
  };
  const run = (override) =>
    JSON.parse(
      execFileSync(
        process.execPath,
        ["scripts/checks/windows-runner-policy.mjs", "--scope", "ci"],
        { encoding: "utf8", windowsHide: true, env: { ...env, ...override } },
      ),
    );
  assert.equal(run().selfHosted, true);
  assert.match(
    readFileSync(output, "utf8"),
    /windows_runs_on=\["self-hosted","Windows","X64","bycoda-windows-isolated"\]/,
  );
  assert.equal(run({ GITHUB_EVENT_NAME: "pull_request" }).runsOn, "windows-latest");
  assert.equal(run({ GITHUB_EVENT_PATH: path.join(root, "missing") }).selfHosted, false);
  assert.equal(
    run({ WINDOWS_SELF_HOSTED_OPT_IN: "false", GITHUB_EVENT_PATH: path.join(root, "missing") })
      .selfHosted,
    false,
  );
});
