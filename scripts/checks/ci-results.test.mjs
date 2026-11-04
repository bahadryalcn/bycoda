import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { gates } from "./ci-changes.mjs";
import { expectedCiSelection, digest } from "./browser-ci.mjs";
import {
  evaluateResults,
  jobs,
  readEvidence,
  recordEvidence,
  validateEvidence,
} from "./ci-results.mjs";

const identity = { sourceSha: "a".repeat(40), runId: "42", runAttempt: "1" };

test("native/Python evidence recording does not load the uninstalled browser runner", () => {
  const moduleUrl = new URL("./ci-results.mjs", import.meta.url).href;
  execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
    import Module from "node:module";
    const original = Module._resolveFilename;
    Module._resolveFilename = function(request, ...args) {
      if (request.startsWith("@playwright/")) throw new Error("Browser dependencies not installed");
      return original.call(this, request, ...args);
    };
    const { recordEvidence } = await import(${JSON.stringify(moduleUrl)});
    const report = recordEvidence({job: "check", variant: "windows-latest",
      result: "failure", sourceSha: "a".repeat(40), runId: "42", runAttempt: "1"});
    if (report.result !== "failure") throw new Error("Lost original job failure");
  `,
    ],
    { windowsHide: true, stdio: "pipe" },
  );
});
function passing(full = true, eventName = "push") {
  const active = (contract) =>
    (!contract.gate || full) && (!contract.events || contract.events.includes(eventName));
  const outputs = {
    ...Object.fromEntries(gates.map((gate) => [gate, String(full)])),
    source_sha: identity.sourceSha,
  };
  const needs = Object.fromEntries(
    Object.entries(jobs).map(([name, contract]) => [
      name,
      { result: active(contract) ? "success" : "skipped" },
    ]),
  );
  needs.changes.outputs = outputs;
  const evidence = Object.entries(jobs).flatMap(([job, contract]) =>
    full && active(contract)
      ? contract.variants.map((variant) => ({
          schemaVersion: 1,
          job,
          variant,
          ...identity,
          result: "success",
          files: (contract.requiredFiles ?? []).map((file) => ({ path: file, bytes: 1 })),
          ...(job === "web"
            ? {
                webBoot: {
                  boundary: "native-unavailable",
                  artifactDigest: "a".repeat(64),
                  sourceFingerprint: "b".repeat(64),
                },
              }
            : {}),
          ...(["browser", "browser-full"].includes(job)
            ? {
                browser: {
                  selectionDigest: expectedCiSelection(variant).digest,
                  suites: expectedCiSelection(variant).suites.map((suite) => ({
                    suite: suite.id,
                    cases: 1,
                    passed: 1,
                    skipped: 0,
                    reportDigest: "a".repeat(64),
                    discoveryDigest: "b".repeat(64),
                  })),
                },
              }
            : {}),
        }))
      : [],
  );
  return { needs, evidence, ...identity, eventName };
}

test("the aggregate accepts full success and only explicitly irrelevant skips", () => {
  assert.equal(evaluateResults(passing()).success, true);
  assert.equal(evaluateResults(passing(false)).success, true);
  for (const result of ["failure", "cancelled", "skipped", "unknown"]) {
    const input = passing();
    input.needs.host.result = result;
    assert.equal(evaluateResults(input).success, false, result);
  }
  const input = passing(false);
  delete input.needs.changes.outputs.browser;
  assert.equal(evaluateResults(input).success, false);
});

test("recorded rerun receipts survive artifact merging and keep strict source/attempt checks", (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "bycoda-ci-rerun-evidence-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const cli = fileURLToPath(new URL("./ci-results.mjs", import.meta.url));
  for (const [runAttempt, result] of [
    ["1", "failure"],
    ["2", "success"],
  ]) {
    execFileSync(
      process.execPath,
      [
        cli,
        "record",
        "--job",
        "check",
        "--variant",
        "ubuntu-latest",
        "--result",
        result,
        "--directory",
        root,
      ],
      {
        windowsHide: true,
        stdio: "pipe",
        env: {
          ...process.env,
          GITHUB_SHA: identity.sourceSha,
          GITHUB_RUN_ID: identity.runId,
          GITHUB_RUN_ATTEMPT: runAttempt,
        },
      },
    );
  }
  const receipts = readEvidence(root).sort((a, b) => Number(a.runAttempt) - Number(b.runAttempt));
  assert.equal(receipts.length, 2);
  assert.deepEqual(
    receipts.map(({ runAttempt, result }) => [runAttempt, result]),
    [
      ["1", "failure"],
      ["2", "success"],
    ],
  );
  const input = passing();
  input.runAttempt = "2";
  input.evidence = input.evidence.filter(
    (entry) => !(entry.job === "check" && entry.variant === "ubuntu-latest"),
  );
  input.evidence.push(...receipts);
  assert.equal(evaluateResults(input).success, true);
  assert.equal(
    evaluateResults({ ...input, evidence: [...input.evidence].reverse() }).success,
    true,
  );
  const latest = receipts.find((entry) => entry.runAttempt === "2");
  const duplicate = evaluateResults({ ...input, evidence: [...input.evidence, { ...latest }] });
  assert.equal(duplicate.success, false);
  assert.ok(duplicate.errors.includes("Duplicate evidence: check/ubuntu-latest"));
  for (const change of [{ runId: "99" }, { sourceSha: "b".repeat(40) }]) {
    const foreign = evaluateResults({
      ...input,
      evidence: [...input.evidence, { ...latest, ...change }],
    });
    assert.equal(foreign.success, false);
    assert.ok(foreign.errors.includes("Stale or foreign evidence: check/ubuntu-latest"));
  }
});

test("failed or missing preflight cannot qualify a release even when downstream evidence exists", () => {
  for (const result of ["failure", "cancelled", "skipped", undefined]) {
    const input = passing();
    input.needs.preflight.result = result;
    assert.equal(evaluateResults(input).success, false);
  }
});

test("passing jobs cannot hide missing, duplicate, stale or foreign evidence", () => {
  for (const mutate of [
    (input) => input.evidence.pop(),
    (input) => input.evidence.push(input.evidence[0]),
    (input) => (input.evidence[0].sourceSha = "b".repeat(40)),
    (input) => (input.evidence[0].runId = "41"),
    (input) => (input.evidence[0].runAttempt = "2"),
    (input) => (input.needs.changes.outputs.source_sha = "b".repeat(40)),
    (input) => delete input.needs.scripts,
    (input) => (input.evidence.find((entry) => entry.job === "host").files = []),
    (input) => input.evidence.find((entry) => entry.job === "scripts").files.pop(),
  ]) {
    const input = passing();
    mutate(input);
    assert.equal(evaluateResults(input).success, false);
  }
});

test("evidence is bounded regular JSON data with fixed fields and real required files", (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "bycoda-ci-results-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(path.join(root, "result.txt"), "fixture result");
  const report = recordEvidence({
    ...identity,
    job: "check",
    variant: "ubuntu-latest",
    result: "success",
    files: ["result.txt"],
    root,
  });
  assert.equal(report.files[0].bytes, 14);
  assert.throws(() =>
    recordEvidence({
      ...identity,
      job: "check",
      variant: "ubuntu-latest",
      result: "success",
      files: ["missing.txt"],
      root,
    }),
  );
  assert.throws(() => validateEvidence({ ...report, command: "untrusted executable" }));
  assert.throws(() => validateEvidence({ ...report, sourceSha: "unknown" }));
  assert.throws(() => validateEvidence({ ...report, result: "neutral" }));
  writeFileSync(path.join(root, "large.json"), " ".repeat(64 * 1024 + 1));
  assert.throws(() => readEvidence(root));
});

test("browser receipts reject wrong source, failed runs and stale fixture evidence", (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "bycoda-browser-receipt-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const receipt = {
    schemaVersion: 1,
    source: { sha: identity.sourceSha, dirty: false },
    evidence: "browser-fixture",
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    code: 0,
    selection: expectedCiSelection("chromium-smoke"),
    suites: [],
  };
  const list = {
    suites: [
      {
        title: "arc-controls.spec.ts",
        specs: [
          {
            title: "fixture behavior",
            file: "arc-controls.spec.ts",
            line: 1,
            tests: [{ projectName: "chromium" }],
          },
        ],
      },
    ],
  };
  const executed = {
    ...list,
    errors: [],
    stats: { expected: 1, skipped: 0, unexpected: 0, flaky: 0 },
  };
  writeFileSync(path.join(root, "list.json"), JSON.stringify(list));
  writeFileSync(path.join(root, "report.json"), JSON.stringify(executed));
  receipt.suites = [
    {
      suite: "arc-controls",
      code: 0,
      discovery: { path: "list.json", sha256: digest(JSON.stringify(list)) },
      report: { path: "report.json", sha256: digest(JSON.stringify(executed)) },
    },
  ];
  const record = () =>
    recordEvidence({
      ...identity,
      job: "browser",
      variant: "chromium-smoke",
      result: "success",
      browserReceipt: "run.json",
      root,
    });
  writeFileSync(path.join(root, "run.json"), JSON.stringify(receipt));
  assert.equal(record().files.length, 3);
  for (const mutation of [
    { source: { sha: "b".repeat(40) } },
    { source: { sha: identity.sourceSha, dirty: true } },
    { code: 1 },
    { evidence: "native-acceptance" },
    { startedAt: "2020-01-01", completedAt: "2020-01-01" },
    { suites: [] },
    { selection: { ...receipt.selection, filters: ["--grep", "one test"] } },
  ]) {
    writeFileSync(path.join(root, "run.json"), JSON.stringify({ ...receipt, ...mutation }));
    assert.throws(record);
  }
  writeFileSync(path.join(root, "run.json"), JSON.stringify(receipt));
  writeFileSync(
    path.join(root, "report.json"),
    JSON.stringify({ ...executed, stats: { ...executed.stats, expected: 0, skipped: 1 } }),
  );
  assert.throws(record);
});

test("main/manual require every full browser partition; PR skips are explicit and event-bound", () => {
  const input = passing();
  input.evidence = input.evidence.filter(
    (entry) => !(entry.job === "browser-full" && entry.variant === "webkit-4-of-4"),
  );
  assert.equal(evaluateResults(input).success, false);
  const pr = passing(true, "pull_request");
  pr.needs["browser-full"].result = "skipped";
  pr.evidence = pr.evidence.filter((entry) => entry.job !== "browser-full");
  assert.equal(evaluateResults(pr).success, true);
  pr.eventName = "push";
  assert.equal(evaluateResults(pr).success, false);
});

test("web success requires a mounted/reloaded production entry with fresh exact source and artifact identity", (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "bycoda-web-boot-receipt-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const receipt = {
    schemaVersion: 1,
    evidence: "built-web-boot",
    outcome: "passed",
    boundary: "native-unavailable",
    selector: "[data-native-unavailable]",
    reloadControl: "exercised",
    runtimeErrors: [],
    source: { sha: identity.sourceSha, dirty: false, sourceFingerprint: "b".repeat(64) },
    artifact: { files: 3, bytes: 1234, contentDigest: "c".repeat(64) },
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
  };
  const record = () =>
    recordEvidence({
      ...identity,
      job: "web",
      variant: "linux",
      result: "success",
      root,
      webReceipt: "boot.json",
    });
  writeFileSync(path.join(root, "boot.json"), JSON.stringify(receipt));
  assert.equal(record().webBoot.artifactDigest, receipt.artifact.contentDigest);
  for (const change of [
    { source: undefined },
    { source: { ...receipt.source, dirty: true } },
    { outcome: "failed" },
    { reloadControl: "not-run" },
    { runtimeErrors: ["native mock required"] },
    { boundary: "workspace" },
    { artifact: { ...receipt.artifact, files: 0 } },
    { completedAt: "2020-01-01" },
  ]) {
    writeFileSync(path.join(root, "boot.json"), JSON.stringify({ ...receipt, ...change }));
    assert.throws(record);
  }
});
