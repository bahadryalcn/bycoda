/** Bounded suite/browser partitions. Weights affect scheduling, never selection. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, lstatSync, realpathSync } from "node:fs";
import { resolve, relative, isAbsolute } from "node:path";
import {
  manifest,
  selectSuites,
  repositoryRoot,
  listedCases,
  compareSelections,
} from "./browser-test-support.mjs";

export const browserShards = { chromium: 6, webkit: 4 };
const weights = JSON.parse(
  readFileSync(new URL("../../tests/browser/ci-weights.json", import.meta.url), "utf8"),
);
export const digest = (value) =>
  createHash("sha256")
    .update(typeof value === "string" || Buffer.isBuffer(value) ? value : JSON.stringify(value))
    .digest("hex");
export const manifestDigest = digest(
  readFileSync(new URL("../../tests/browser/suites.json", import.meta.url)),
);

export function partitionSuites(suites, project, shard = 1, count = 1) {
  assert(
    Number.isInteger(count) &&
      count > 0 &&
      count <= 16 &&
      Number.isInteger(shard) &&
      shard >= 1 &&
      shard <= count,
    "Invalid browser shard",
  );
  assert(count === 1 || project, "Sharding requires one named browser project");
  const eligible = suites.filter(
    (suite) => !project || suite.projects.some((entry) => entry.name === project),
  );
  const bins = Array.from({ length: count }, (_, index) => ({ index, weight: 0, suites: [] }));
  const weight = (suite) => weights.cases[suite.id]?.[project] ?? suite.files.length;
  for (const suite of [...eligible].sort(
    (a, b) => weight(b) - weight(a) || a.id.localeCompare(b.id),
  )) {
    const bin = [...bins].sort(
      (a, b) => a.weight - b.weight || a.suites.length - b.suites.length || a.index - b.index,
    )[0];
    bin.suites.push(suite);
    bin.weight += weight(suite);
  }
  return bins[shard - 1].suites.sort((a, b) => a.id.localeCompare(b.id));
}

export function selectionPlan({
  suites = selectSuites(["all"]),
  includeVariants = false,
  project = null,
  shard = 1,
  count = 1,
  filters = [],
} = {}) {
  const entries = includeVariants
    ? [
        ...suites,
        ...manifest.suites.filter(
          (suite) =>
            suite.variantOf &&
            suites.some((entry) => entry.id === suite.variantOf) &&
            !suites.some((entry) => entry.id === suite.id),
        ),
      ]
    : suites;
  const selected = partitionSuites(entries, project, shard, count);
  const plan = {
    manifestDigest,
    policy: includeVariants ? "defaults-and-explicit-variants" : "selected-owners",
    project,
    shard,
    count,
    filters,
    suites: selected.map((suite) => ({
      id: suite.id,
      projects: suite.projects
        .filter((entry) => !project || entry.name === project)
        .map((entry) => entry.name),
      variantOf: suite.variantOf ?? null,
    })),
  };
  return { suites: selected, selection: { ...plan, digest: digest(plan) } };
}

export function browserCiVariants() {
  return Object.entries(browserShards).flatMap(([project, count]) =>
    Array.from({ length: count }, (_, index) => ({
      project,
      shard: index + 1,
      count,
      variant: `${project}-${index + 1}-of-${count}`,
    })),
  );
}

export function expectedCiSelection(variant) {
  if (variant === "chromium-smoke")
    return selectionPlan({ suites: selectSuites(["smoke"]), project: "chromium" }).selection;
  const entry = browserCiVariants().find((item) => item.variant === variant);
  assert(entry, "Unknown browser CI variant");
  return selectionPlan({ includeVariants: true, ...entry }).selection;
}

function dataFile(root, filename, limit = 32 * 1024 * 1024) {
  const absolute = resolve(root, filename);
  const local = relative(root, absolute);
  assert(
    local && !local.startsWith("..") && !isAbsolute(local),
    "Browser evidence escapes checkout",
  );
  const stat = lstatSync(absolute);
  const actual = relative(realpathSync(root), realpathSync(absolute));
  assert(
    actual && !actual.startsWith("..") && !isAbsolute(actual),
    "Browser evidence follows a link outside checkout",
  );
  assert(
    stat.isFile() && !stat.isSymbolicLink() && stat.size > 0 && stat.size <= limit,
    "Browser evidence must be bounded regular data",
  );
  return readFileSync(absolute);
}

export function validateBrowserReceipt(
  receipt,
  { sourceSha, variant, root = repositoryRoot, requireClean = true } = {},
) {
  assert.equal(receipt.schemaVersion, 1, "Unsupported browser receipt");
  assert.equal(receipt.evidence, "browser-fixture", "Expected actual browser fixture evidence");
  assert.equal(receipt.source?.sha, sourceSha, "Foreign browser source");
  if (requireClean) assert.equal(receipt.source?.dirty, false, "CI browser source must be clean");
  assert.equal(receipt.code, 0, "Browser run failed");
  const started = Date.parse(receipt.startedAt),
    completed = Date.parse(receipt.completedAt);
  assert(
    Number.isFinite(started) &&
      completed >= started &&
      completed <= Date.now() + 60000 &&
      completed >= Date.now() - 86400000,
    "Stale browser receipt",
  );
  const expected = expectedCiSelection(variant);
  assert.deepEqual(
    receipt.selection,
    expected,
    "Browser selection is incomplete, stale or belongs to another partition",
  );
  assert.deepEqual(
    receipt.suites.map((suite) => suite.suite),
    expected.suites.map((suite) => suite.id),
    "Missing, duplicate or reordered browser suite outcomes",
  );
  const files = [],
    summaries = [];
  for (const suite of receipt.suites) {
    assert.equal(suite.code, 0, "A browser suite failed");
    const listed = dataFile(root, suite.discovery.path),
      executed = dataFile(root, suite.report.path);
    assert.equal(digest(listed), suite.discovery.sha256, "Browser discovery hash mismatch");
    assert.equal(digest(executed), suite.report.sha256, "Browser execution hash mismatch");
    const before = JSON.parse(listed),
      after = JSON.parse(executed);
    const cases = listedCases(before),
      actual = listedCases(after),
      parity = compareSelections(cases, actual);
    assert(
      cases.length > 0 &&
        parity.missing.length === 0 &&
        parity.added.length === 0 &&
        actual.length === cases.length,
      "Browser execution omitted or duplicated discovered cases",
    );
    assert.equal(after.errors?.length ?? 0, 0, "Browser reporter errors");
    assert.equal(after.stats?.unexpected, 0, "Unexpected browser failures");
    assert.equal(after.stats?.flaky, 0, "Browser retries must not conceal failure");
    assert.equal(
      after.stats.expected + after.stats.skipped,
      cases.length,
      "Browser results incomplete",
    );
    assert(after.stats.expected > 0, "A selected suite executed no passing browser cases");
    files.push(suite.discovery.path, suite.report.path);
    summaries.push({
      suite: suite.suite,
      cases: cases.length,
      passed: after.stats.expected,
      skipped: after.stats.skipped,
      discoveryDigest: digest(cases),
      reportDigest: digest(executed),
    });
  }
  return { selectionDigest: expected.digest, manifestDigest, suites: summaries, files };
}
