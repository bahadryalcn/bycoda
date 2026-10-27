import assert from "node:assert/strict";
import test from "node:test";
import { manifest, selectSuites } from "./browser-test-support.mjs";
import {
  browserCiVariants,
  expectedCiSelection,
  partitionSuites,
  selectionPlan,
} from "./browser-ci.mjs";

test("full CI partitions preserve every suite/browser pair including deliberate fixture variants exactly once", () => {
  const expected = manifest.suites
    .flatMap((suite) => suite.projects.map((project) => `${suite.id}/${project.name}`))
    .sort();
  const actual = browserCiVariants()
    .flatMap((variant) =>
      expectedCiSelection(variant.variant).suites.flatMap((suite) =>
        suite.projects.map((project) => `${suite.id}/${project}`),
      ),
    )
    .sort();
  assert.deepEqual(actual, expected);
  assert.equal(new Set(actual).size, actual.length);
  for (const suite of manifest.suites.filter((suite) => suite.variantOf))
    assert(actual.some((key) => key.startsWith(`${suite.id}/`)));
});

test("partition scheduling is deterministic, project-bound and refuses invalid/empty shard ranges", () => {
  const suites = selectSuites(["all"]);
  assert.deepEqual(
    partitionSuites(suites, "chromium", 1, 6),
    partitionSuites([...suites].reverse(), "chromium", 1, 6),
  );
  assert.throws(() => partitionSuites(suites, null, 1, 6));
  assert.throws(() => partitionSuites(suites, "chromium", 0, 6));
  assert.throws(() => partitionSuites(suites, "chromium", 7, 6));
  assert.throws(() => partitionSuites(suites, "chromium", 1, 100));
  assert.notEqual(
    selectionPlan({ filters: ["--grep", "one case"] }).selection.digest,
    selectionPlan().selection.digest,
  );
});
