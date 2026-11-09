import assert from "node:assert/strict";
import test from "node:test";
import { baselines, compareBaseline, parseApprovals, parseArguments } from "./check-baselines.mjs";

const totalsFor = (file, json) => baselines.find((entry) => entry.file === file).totals(json, file);
const run = (base, current, approvals = []) =>
  compareBaseline({
    baseline: "invariants-baseline.json",
    base: new Map(Object.entries(base)),
    current: new Map(Object.entries(current)),
    approvals,
  });
const approval = (extra) => ({
  baseline: "invariants-baseline.json",
  rule: "r",
  from: 1,
  to: 3,
  reason: "why",
  ...extra,
});

test("a rise without approval fails and names the numbers", () => {
  const { failures } = run({ r: 1 }, { r: 2 });
  assert.equal(failures.length, 1);
  assert.match(failures[0], /rose from 1 to 2/);
});

test("an approved rise passes and a covering approval may exceed the new total", () => {
  assert.deepEqual(run({ r: 1 }, { r: 3 }, [approval()]).failures, []);
  assert.deepEqual(run({ r: 1 }, { r: 2 }, [approval()]).failures, []);
});

test("an approval with the wrong from or too small a to fails", () => {
  assert.equal(run({ r: 2 }, { r: 3 }, [approval()]).failures.length, 1);
  assert.equal(run({ r: 1 }, { r: 4 }, [approval()]).failures.length, 1);
});

test("a fall or equal total passes and an unused approval becomes a notice", () => {
  assert.deepEqual(run({ r: 3 }, { r: 2 }).failures, []);
  const result = run({ r: 3 }, { r: 3 }, [approval()]);
  assert.deepEqual(result.failures, []);
  assert.equal(result.notices.length, 1);
});

test("a rule absent at the base counts as zero, so a new rule needs approval", () => {
  assert.equal(run({}, { fresh: 2 }).failures.length, 1);
  const approved = approval({ rule: "fresh", from: 0, to: 2 });
  assert.deepEqual(run({}, { fresh: 2 }, [approved]).failures, []);
});

test("moving findings between files is not a rise", () => {
  const before = totalsFor("invariants-baseline.json", { counts: { "a.ts": { r: 2 } } });
  const after = totalsFor("invariants-baseline.json", {
    counts: { "b.ts": { r: 1 }, "c.ts": { r: 1 } },
  });
  assert.deepEqual(run(Object.fromEntries(before), Object.fromEntries(after)).failures, []);
});

test("totals follow each baseline shape", () => {
  const structure = {
    counts: { "a.ts": { "file-lines": 900 }, "b.ts": { "file-lines": 700, x: 4 } },
  };
  assert.equal(totalsFor("code-structure-baseline.json", structure).get("file-lines"), 2);
  const lint = { counts: { "a.ts|eslint(no-x)": 2, "b.ts|eslint(no-x)": 3 } };
  assert.equal(totalsFor("lint-baseline.json", lint).get("eslint(no-x)"), 5);
  const types = { counts: { "a.test.ts": 2, "b.test.ts": 1 } };
  assert.equal(totalsFor("test-types-baseline.json", types).get("type-errors"), 3);
  assert.throws(() => totalsFor("lint-baseline.json", { counts: { broken: 1 } }));
  assert.throws(() => totalsFor("invariants-baseline.json", {}));
});

test("malformed approvals and arguments are rejected", () => {
  assert.throws(() => parseApprovals({}));
  assert.throws(() => parseApprovals({ approvals: [approval({ reason: " " })] }));
  assert.throws(() => parseApprovals({ approvals: [approval({ from: "1" })] }));
  assert.equal(parseApprovals({ approvals: [approval()] }).length, 1);
  assert.deepEqual(parseArguments(["--base", "HEAD"]), { base: "HEAD" });
  assert.throws(() => parseArguments(["--base"]));
  assert.throws(() => parseArguments(["--nope"]));
});
