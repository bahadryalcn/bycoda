import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { evaluateWindowsRunnerTrust } from "./windows-runner-trust.mjs";
import { windowsContext } from "./windows-runner-policy-fixtures.mjs";
test("machine admission permits only known caller/workload pairs and exact trusted refs", () => {
  const fixtures = [
    [windowsContext(), "ci"],
    [windowsContext({ job: "check", eventName: "workflow_dispatch" }), "ci"],
    [windowsContext({ workflow: "release-cache.yml", job: "warm" }), "release-cache"],
    [
      windowsContext({
        workflow: "release-cache.yml",
        job: "warm",
        eventName: "workflow_dispatch",
      }),
      "release-cache",
    ],
    [
      windowsContext({ workflow: "release.yml", job: "package", ref: "refs/tags/v0.6.94" }),
      "package",
    ],
    [
      windowsContext({
        workflow: "release-candidate.yml",
        job: "package",
        eventName: "workflow_dispatch",
      }),
      "package",
    ],
    [
      windowsContext({ workflow: "nightly-candidate.yml", job: "package", eventName: "schedule" }),
      "package",
    ],
    [
      windowsContext({
        workflow: "nightly-candidate.yml",
        job: "package",
        eventName: "workflow_dispatch",
      }),
      "package",
    ],
  ];
  for (const [input, scope] of fixtures) {
    assert.deepEqual(evaluateWindowsRunnerTrust(input, { scope, requireHeavyJob: true }), {
      allowed: true,
      reason: "trusted-workflow-source",
      scope,
    });
    assert.equal(
      evaluateWindowsRunnerTrust({ ...input, job: "arbitrary-code" }, { requireHeavyJob: true })
        .allowed,
      false,
    );
    for (const mutation of [
      { eventName: "pull_request" },
      { refType: "unknown" },
      { workflowSha: "b".repeat(40) },
      { runId: "" },
      { runAttempt: "0" },
    ])
      assert.equal(
        evaluateWindowsRunnerTrust({ ...input, ...mutation }, { requireHeavyJob: true }).allowed,
        false,
      );
  }
  const annotated = windowsContext({
    workflow: "release.yml",
    job: "package",
    ref: "refs/tags/v0.6.94",
  });
  assert.equal(
    evaluateWindowsRunnerTrust({
      ...annotated,
      event: { ...annotated.event, after: "b".repeat(40) },
    }).allowed,
    true,
  );
});
test("manual nondefault refs, release-like PR tags and unlisted reusable callers cannot gain admission", () => {
  for (const input of [
    windowsContext({
      workflow: "release.yml",
      job: "package",
      eventName: "workflow_dispatch",
      ref: "refs/tags/v0.6.94",
    }),
    windowsContext({
      workflow: "release-candidate.yml",
      job: "package",
      eventName: "workflow_dispatch",
      ref: "refs/heads/feature",
    }),
    windowsContext({
      workflow: "desktop-package.yml",
      job: "package",
      eventName: "workflow_dispatch",
    }),
    windowsContext({ workflow: "release-candidate.yml", job: "package" }),
    windowsContext({
      workflow: "ci.yml",
      eventName: "workflow_dispatch",
      ref: "refs/tags/v0.6.94",
    }),
  ])
    assert.equal(evaluateWindowsRunnerTrust(input, { requireHeavyJob: true }).allowed, false);
  const manual = windowsContext({ eventName: "workflow_dispatch" });
  assert.equal(
    evaluateWindowsRunnerTrust({ ...manual, event: { ...manual.event, ref: "feature" } }).allowed,
    false,
  );
});
test("dedicated VM preflight admits reviewed manual main before opt-in", () => {
  const input = windowsContext({
    workflow: "windows-runner-check.yml",
    eventName: "workflow_dispatch",
    job: "verify",
  });
  assert.equal(
    evaluateWindowsRunnerTrust(input, { scope: "ci", requireHeavyJob: true }).allowed,
    true,
  );
});
test("dedicated VM preflight denies push, schedule, PR and nondefault manual sources", () => {
  for (const eventName of ["push", "schedule", "pull_request", "pull_request_target"])
    assert.equal(
      evaluateWindowsRunnerTrust(
        windowsContext({ workflow: "windows-runner-check.yml", eventName, job: "verify" }),
        { requireHeavyJob: true },
      ).allowed,
      false,
    );
  assert.equal(
    evaluateWindowsRunnerTrust(
      windowsContext({
        workflow: "windows-runner-check.yml",
        eventName: "workflow_dispatch",
        job: "verify",
        ref: "refs/heads/feature",
      }),
      { requireHeavyJob: true },
    ).allowed,
    false,
  );
});
test("protected pre-job CLI fails before work for PR or missing metadata, ignoring payload env overrides", (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "bycoda-windows-admission-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const eventFile = path.join(root, "event.json"),
    input = windowsContext();
  writeFileSync(
    eventFile,
    JSON.stringify({
      ...input.event,
      env: { GITHUB_EVENT_NAME: "push", ACTIONS_RUNNER_HOOK_JOB_STARTED: "attacker.ps1" },
    }),
  );
  const env = {
    ...process.env,
    GITHUB_EVENT_PATH: eventFile,
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
    GITHUB_JOB: input.job,
  };
  const args = ["scripts/checks/windows-runner-trust.mjs", "--pre-job"];
  assert.equal(
    JSON.parse(execFileSync(process.execPath, args, { env, encoding: "utf8", windowsHide: true }))
      .allowed,
    true,
  );
  for (const override of [
    { GITHUB_EVENT_NAME: "pull_request" },
    { GITHUB_JOB: "unexpected" },
    { GITHUB_EVENT_PATH: path.join(root, "missing") },
    { GITHUB_REPOSITORY_ID: "1" },
  ]) {
    const result = spawnSync(process.execPath, args, {
      env: { ...env, ...override },
      encoding: "utf8",
      windowsHide: true,
    });
    assert.equal(result.status, 1);
    assert.equal(JSON.parse(result.stdout).allowed, false);
  }
});
