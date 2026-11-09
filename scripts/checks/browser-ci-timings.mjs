/** Import historical fixture timings as scheduling advice, never CI acceptance. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { listedCases, compareSelections, repositoryRoot } from "./browser-test-support.mjs";

const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const positive = (value) => typeof value === "number" && Number.isFinite(value) && value > 0;
const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b),
    middle = Math.floor(sorted.length / 2);
  assert(sorted.length > 0, "No usable timing samples");
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
function readData(root, filename) {
  assert(
    typeof filename === "string" && filename && !filename.includes("\0"),
    "Invalid timing evidence path",
  );
  const absolute = resolve(root, filename),
    local = relative(root, absolute);
  assert(
    local && !local.startsWith("..") && !isAbsolute(local),
    "Timing evidence escapes checkout",
  );
  const actual = relative(realpathSync(root), realpathSync(absolute)),
    stat = lstatSync(absolute);
  assert(
    actual && !actual.startsWith("..") && !isAbsolute(actual),
    "Timing evidence follows a link outside checkout",
  );
  assert(
    stat.isFile() && !stat.isSymbolicLink() && stat.size > 0 && stat.size <= 32 * 1024 * 1024,
    "Timing evidence must be bounded regular data",
  );
  return readFileSync(absolute);
}
function hashedReport(root, reference) {
  assert(reference && /^[a-f0-9]{64}$/.test(reference.sha256), "Missing timing evidence hash");
  assert(
    typeof reference.path === "string" &&
      !isAbsolute(reference.path) &&
      !reference.path.includes("\\") &&
      reference.path
        .split("/")
        .every((part) => part && part !== "." && part !== ".." && !part.includes(":")),
    "Unsafe timing report path",
  );
  const bytes = readData(root, reference.path);
  assert.equal(digest(bytes), reference.sha256, "Timing evidence hash mismatch");
  return JSON.parse(bytes);
}
function validateReport(report, project, executed = false) {
  assert(
    Array.isArray(report.suites) && Array.isArray(report.errors) && report.errors.length === 0,
    "Malformed or failed Playwright report",
  );
  const tests = [];
  function visit(suites) {
    for (const suite of suites) {
      assert(
        suite &&
          Array.isArray(suite.specs) &&
          (suite.suites === undefined || Array.isArray(suite.suites)),
        "Truncated Playwright suite",
      );
      for (const spec of suite.specs) {
        assert(
          typeof spec.file === "string" &&
            spec.file &&
            Number.isInteger(spec.line) &&
            spec.line > 0 &&
            typeof spec.title === "string" &&
            Array.isArray(spec.tests) &&
            spec.tests.length > 0,
          "Malformed Playwright spec",
        );
        for (const test of spec.tests) {
          assert(test.projectName === project, "Mixed or foreign project timing");
          if (executed) {
            assert(
              ["expected", "skipped"].includes(test.status),
              "Failed or flaky Playwright case",
            );
            assert(Array.isArray(test.results), "Missing Playwright case results");
            if (test.status === "expected") {
              assert(
                test.expectedStatus === "passed" && test.results.length === 1,
                "Retried or unsuccessful Playwright case",
              );
              const result = test.results[0];
              assert(
                result.status === "passed" &&
                  result.retry === 0 &&
                  Number.isFinite(result.duration) &&
                  result.duration >= 0 &&
                  !result.error &&
                  Array.isArray(result.errors) &&
                  result.errors.length === 0,
                "Failed or retried Playwright result",
              );
            } else {
              assert(
                test.expectedStatus === "skipped" &&
                  test.results.every(
                    (result) =>
                      result.status === "skipped" &&
                      !result.error &&
                      (result.errors?.length ?? 0) === 0,
                  ),
                "Invalid skipped Playwright case",
              );
            }
          }
          tests.push(test);
        }
      }
      visit(suite.suites ?? []);
    }
  }
  visit(report.suites);
  assert(tests.length > 0, "Empty Playwright timing report");
  if (executed) {
    const stats = report.stats;
    assert(
      stats &&
        stats.unexpected === 0 &&
        stats.flaky === 0 &&
        Number.isInteger(stats.expected) &&
        stats.expected > 0 &&
        Number.isInteger(stats.skipped) &&
        stats.skipped >= 0 &&
        Number.isFinite(stats.duration) &&
        stats.duration >= 0,
      "Failed, flaky or incomplete Playwright statistics",
    );
    assert.equal(
      stats.expected,
      tests.filter((test) => test.status === "expected").length,
      "Truncated Playwright passing results",
    );
    assert.equal(
      stats.skipped,
      tests.filter((test) => test.status === "skipped").length,
      "Truncated Playwright skipped results",
    );
  }
  return listedCases(report);
}
export function importBrowserTimings({ receipts, weights, root = repositoryRoot }) {
  root = resolve(root);
  assert(
    weights?.schemaVersion === 1 &&
      weights.cases &&
      typeof weights.cases === "object" &&
      !Array.isArray(weights.cases),
    "Invalid existing browser weights",
  );
  const cases = structuredClone(weights.cases);
  for (const [suite, projects] of Object.entries(cases)) {
    assert(
      /^[a-z0-9][a-z0-9-]*$/.test(suite) &&
        projects &&
        typeof projects === "object" &&
        !Array.isArray(projects),
      "Invalid suite case counts",
    );
    for (const [project, count] of Object.entries(projects))
      assert(
        /^[a-z][a-z0-9-]*$/.test(project) && Number.isInteger(count) && count > 0,
        "Invalid project case count",
      );
  }
  assert(
    Array.isArray(receipts) && receipts.length > 0 && receipts.length <= 500,
    "Supply one or more bounded timing receipts",
  );
  const samples = new Map(),
    perCase = [],
    seen = new Set();
  let dirty = false;
  for (const filename of receipts) {
    const receiptBytes = readData(root, filename),
      receiptHash = digest(receiptBytes);
    assert(!seen.has(receiptHash), "Duplicate timing receipt");
    seen.add(receiptHash);
    const receipt = JSON.parse(receiptBytes),
      selection = receipt.selection;
    assert(
      receipt.schemaVersion === 1 &&
        receipt.evidence === "browser-fixture" &&
        receipt.code === 0 &&
        /^[a-f0-9]{40}$/.test(receipt.source?.sha) &&
        typeof receipt.source?.dirty === "boolean",
      "Not a successful browser fixture receipt",
    );
    const started = Date.parse(receipt.startedAt),
      completed = Date.parse(receipt.completedAt);
    assert(
      Number.isFinite(started) && Number.isFinite(completed) && completed > started,
      "Incomplete timing receipt",
    );
    assert(
      selection &&
        typeof selection.project === "string" &&
        Array.isArray(selection.filters) &&
        selection.filters.length === 0 &&
        Array.isArray(selection.suites) &&
        selection.suites.length > 0,
      "Timings require complete, unfiltered single-project selections",
    );
    const { digest: selectionDigest, ...plan } = selection;
    assert.equal(digest(JSON.stringify(plan)), selectionDigest, "Timing selection digest differs");
    assert(Array.isArray(receipt.suites), "Missing timing suite results");
    assert.deepEqual(
      receipt.suites.map((suite) => suite.suite),
      selection.suites.map((suite) => suite.id),
      "Truncated or reordered timing receipt",
    );
    const suiteIds = new Set();
    let elapsed = 0;
    for (const [index, outcome] of receipt.suites.entries()) {
      const selected = selection.suites[index],
        project = selection.project;
      assert(!suiteIds.has(outcome.suite), "Duplicate timing suite");
      suiteIds.add(outcome.suite);
      assert.deepEqual(selected.projects, [project], "Ambiguous multi-project suite timing");
      assert(
        Number.isInteger(cases[outcome.suite]?.[project]) && cases[outcome.suite][project] > 0,
        "Timing suite/project missing from supplied case inventory",
      );
      assert(
        outcome.code === 0 &&
          !outcome.signal &&
          !outcome.filteredOut &&
          positive(outcome.durationMs),
        "Failed or invalid suite timing",
      );
      elapsed += outcome.durationMs;
      const discovery = hashedReport(root, outcome.discovery),
        report = hashedReport(root, outcome.report);
      const before = validateReport(discovery, project),
        after = validateReport(report, project, true),
        parity = compareSelections(before, after);
      assert(
        before.length === after.length &&
          parity.before === before.length &&
          parity.after === after.length &&
          parity.missing.length === 0 &&
          parity.added.length === 0,
        "Incomplete or duplicate timing case coverage",
      );
      assert.equal(
        before.length,
        cases[outcome.suite][project],
        "Timing receipt differs from supplied complete case inventory",
      );
      assert(
        report.stats.duration <= outcome.durationMs + 1000,
        "Report duration exceeds measured suite elapsed time",
      );
      const key = `${outcome.suite}/${project}`;
      if (!samples.has(key)) samples.set(key, []);
      samples.get(key).push(outcome.durationMs);
      perCase.push(outcome.durationMs / before.length);
    }
    assert(elapsed <= completed - started + 1000, "Suite timings exceed receipt elapsed time");
    dirty ||= receipt.source.dirty;
  }
  const durationMs = {};
  for (const [key, values] of [...samples].sort(([a], [b]) => a.localeCompare(b))) {
    const [suite, project] = key.split("/");
    (durationMs[suite] ??= {})[project] = median(values);
  }
  return {
    schemaVersion: 1,
    basis: `Advisory scheduling only; median measured suite elapsed from ${receipts.length} successful complete nonflaky browser-fixture receipts; ${dirty ? "includes dirty local fixture sources" : "clean fixture sources"}; not coverage or acceptance authority`,
    cases,
    durationMs,
    fallbackMsPerCase: median(perCase),
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { values } = parseArgs({
    options: {
      receipt: { type: "string", multiple: true },
      weights: { type: "string", default: "tests/browser/ci-weights.json" },
      output: { type: "string" },
    },
  });
  const weights = JSON.parse(readData(repositoryRoot, values.weights));
  const output = importBrowserTimings({ receipts: values.receipt, weights });
  const text = JSON.stringify(output, null, 2) + "\n";
  if (values.output) {
    const file = resolve(values.output),
      local = relative(resolve(repositoryRoot, "temp"), file);
    assert(
      local && !local.startsWith("..") && !isAbsolute(local),
      "Advisory output must stay under checkout temp/; source weights are never autoedited",
    );
    let ancestor = dirname(file);
    for (;;) {
      try {
        const existing = lstatSync(ancestor),
          actual = relative(realpathSync(repositoryRoot), realpathSync(ancestor));
        assert(
          existing.isDirectory() &&
            !existing.isSymbolicLink() &&
            actual &&
            !actual.startsWith("..") &&
            !isAbsolute(actual),
          "Advisory output cannot follow links outside checkout",
        );
        break;
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
        ancestor = dirname(ancestor);
      }
    }
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text, { flag: "wx" });
  } else process.stdout.write(text);
}
