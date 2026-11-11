import assert from "node:assert/strict";
import test from "node:test";
import { compareLintCounts } from "./check-lint-baseline.mjs";

const baseline = { "src/a.ts|eslint(no-unused-vars)": 2 };
const compare = (counts) => compareLintCounts({ counts, baseline });

test("an increase over the baseline fails", () => {
  const result = compare({ "src/a.ts|eslint(no-unused-vars)": 3 });
  assert.equal(result.failed, true);
  assert.deepEqual(result.increases, [{ key: "src/a.ts|eslint(no-unused-vars)", added: 1 }]);
});

test("equal and lower counts pass", () => {
  assert.equal(compare({ "src/a.ts|eslint(no-unused-vars)": 2 }).failed, false);
  assert.equal(compare({ "src/a.ts|eslint(no-unused-vars)": 1 }).failed, false);
  assert.equal(compare({}).failed, false);
});

test("a warning in a file absent from the baseline fails", () => {
  const result = compare({ "src/new.ts|eslint(no-control-regex)": 1 });
  assert.equal(result.failed, true);
  assert.equal(result.increases[0].added, 1);
});
