import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { importBrowserTimings } from "./browser-ci-timings.mjs";

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "bycoda-browser-timings-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const weights = {
    schemaVersion: 1,
    basis: "fixture counts",
    cases: { alpha: { chromium: 2 }, beta: { webkit: 1 }, unmeasured: { chromium: 17 } },
  };
  function receipt(
    name = "first",
    { suite = "alpha", project = "chromium", durationMs = 2000, dirty = true } = {},
  ) {
    mkdirSync(join(root, name), { recursive: true });
    const count = weights.cases[suite][project];
    const specs = Array.from({ length: count }, (_, index) => ({
      file: `${suite}.spec.ts`,
      line: index + 1,
      title: `Case ${index}`,
      tests: [
        {
          projectName: project,
          expectedStatus: "passed",
          status: "expected",
          results: [{ retry: 0, status: "passed", duration: 20, errors: [] }],
        },
      ],
    }));
    const report = {
      suites: [{ title: `${suite}.spec.ts`, specs }],
      errors: [],
      stats: { expected: count, skipped: 0, unexpected: 0, flaky: 0, duration: durationMs - 100 },
    };
    const discovery = structuredClone(report);
    for (const spec of discovery.suites[0].specs) {
      delete spec.tests[0].status;
      spec.tests[0].results = [];
    }
    const plan = {
      manifestDigest: "a".repeat(64),
      policy: "selected-owners",
      project,
      shard: 1,
      count: 1,
      filters: [],
      suites: [{ id: suite, projects: [project], variantOf: null }],
    };
    const run = {
      schemaVersion: 1,
      runId: name,
      source: { sha: "a".repeat(40), dirty },
      evidence: "browser-fixture",
      code: 0,
      startedAt: "2026-10-31T00:00:00.000Z",
      completedAt: "2026-10-31T00:00:20.000Z",
      selection: { ...plan, digest: hash(JSON.stringify(plan)) },
      suites: [{ suite, code: 0, signal: null, durationMs }],
    };
    const save = () => {
      for (const [key, data] of Object.entries({ discovery, report })) {
        const bytes = JSON.stringify(data),
          path = `${name}/${key}.json`;
        writeFileSync(join(root, path), bytes);
        run.suites[0][key] = { path, sha256: hash(bytes) };
      }
      writeFileSync(join(root, `${name}/run.json`), JSON.stringify(run));
    };
    save();
    return { run, report, discovery, save, path: `${name}/run.json` };
  }
  return { root, weights, receipt };
}
test("imports median elapsed times, preserves all counts and labels dirty local fixtures advisory", (t) => {
  const f = fixture(t),
    a = f.receipt(),
    b = f.receipt("second", { durationMs: 4000 }),
    c = f.receipt("third", { suite: "beta", project: "webkit", durationMs: 5000, dirty: false });
  const original = JSON.stringify(f.weights);
  const result = importBrowserTimings({
    receipts: [a.path, b.path, c.path],
    root: f.root,
    weights: f.weights,
  });
  assert.deepEqual(result.durationMs, { alpha: { chromium: 3000 }, beta: { webkit: 5000 } });
  assert.equal(result.fallbackMsPerCase, 2000);
  assert.deepEqual(result.cases, f.weights.cases);
  assert.equal(JSON.stringify(f.weights), original);
  assert.match(result.basis, /Advisory scheduling only/);
  assert.match(result.basis, /dirty local fixture/);
  assert(!("unmeasured" in result.durationMs));
});
test("rejects failed, flaky, retried, truncated and filtered receipts even with valid hashes", (t) => {
  const changes = [
    (f) => {
      f.run.code = 1;
    },
    (f) => {
      f.run.suites[0].code = 1;
    },
    (f) => {
      delete f.run.completedAt;
    },
    (f) => {
      f.run.evidence = "list-only";
    },
    (f) => {
      f.run.selection.filters.push("--grep=one");
    },
    (f) => {
      f.run.suites = [];
    },
    (f) => {
      f.report.stats.flaky = 1;
    },
    (f) => {
      f.report.stats.unexpected = 1;
    },
    (f) => {
      f.report.suites[0].specs[0].tests[0].status = "flaky";
    },
    (f) => {
      f.report.suites[0].specs[0].tests[0].results[0].retry = 1;
    },
    (f) => {
      f.report.suites[0].specs[0].tests[0].results.push({ status: "passed" });
    },
    (f) => {
      f.report.suites[0].specs[0].tests[0].results = [];
    },
    (f) => {
      f.report.suites[0].specs.pop();
    },
    (f) => {
      f.report.stats.expected = 0;
    },
    (f) => {
      f.report.errors.push({ message: "worker died" });
    },
    (f) => {
      f.run.suites[0].durationMs = 0;
    },
    (f) => {
      f.run.suites[0].durationMs = 999999;
    },
  ];
  for (const [index, change] of changes.entries()) {
    const f = fixture(t),
      receipt = f.receipt(`invalid-${index}`);
    // The receipt suite omission needs saving before changing the suites array.
    change(receipt);
    if (receipt.run.suites.length) receipt.save();
    else writeFileSync(join(f.root, receipt.path), JSON.stringify(receipt.run));
    assert.throws(
      () => importBrowserTimings({ receipts: [receipt.path], root: f.root, weights: f.weights }),
      `invalid case ${index}`,
    );
  }
});
test("rejects tampering, missing reports, traversal, linked evidence and duplicate receipts", (t) => {
  const f = fixture(t),
    r = f.receipt();
  const run = () => importBrowserTimings({ receipts: [r.path], root: f.root, weights: f.weights });
  assert.throws(
    () => importBrowserTimings({ receipts: [r.path, r.path], root: f.root, weights: f.weights }),
    /Duplicate timing receipt/,
  );
  const reportPath = join(f.root, r.run.suites[0].report.path);
  writeFileSync(reportPath, "{}");
  assert.throws(run, /hash mismatch/);
  r.save();
  rmSync(reportPath);
  assert.throws(run, /ENOENT/);
  r.save();
  r.run.suites[0].report.path = "first/../first/report.json";
  writeFileSync(join(f.root, r.path), JSON.stringify(r.run));
  assert.throws(run, /Unsafe timing report path/);
  r.save();
  const actual = join(f.root, "actual-report.json");
  writeFileSync(actual, readFileSync(reportPath));
  rmSync(reportPath);
  try {
    symlinkSync(actual, reportPath, "file");
  } catch (error) {
    if (error.code === "EPERM") return;
    throw error;
  }
  assert.throws(run, /bounded regular data/);
});
test("rejects duplicate cases and incompatible case inventories instead of learning partial-suite timings", (t) => {
  const f = fixture(t),
    r = f.receipt();
  r.report.suites[0].specs[1] = structuredClone(r.report.suites[0].specs[0]);
  r.save();
  assert.throws(
    () => importBrowserTimings({ receipts: [r.path], root: f.root, weights: f.weights }),
    /duplicate timing case coverage/,
  );
  const other = f.receipt("complete");
  f.weights.cases.alpha.chromium = 3;
  assert.throws(
    () => importBrowserTimings({ receipts: [other.path], root: f.root, weights: f.weights }),
    /supplied complete case inventory/,
  );
});
