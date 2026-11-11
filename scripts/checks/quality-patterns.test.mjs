import assert from "node:assert/strict";
import test from "node:test";
import { reviewQualityPatterns } from "./quality-patterns.mjs";

test("flags real timer waits and leaves event-driven completion alone", () => {
  const text =
    'await new Promise((resolve) => setTimeout(resolve, 50));\nawait new Promise((done) => { setTimeout(() => done(), 20); });\nawait new Promise((resolve) => emitter.once("completed", resolve));';
  assert.deepEqual(
    reviewQualityPatterns(text, "src/demo.test.ts").map(({ rule, line }) => ({ rule, line })),
    [
      { rule: "timer-promise-review", line: 1 },
      { rule: "timer-promise-review", line: 2 },
    ],
  );
  assert.deepEqual(
    reviewQualityPatterns("setTimeout(() => expireLease(), 100);", "src/demo.ts"),
    [],
  );
});

test("suppressions are left to bycoda/suppression-has-reason, the single definition", () => {
  assert.deepEqual(
    reviewQualityPatterns("// oxlint-disable-next-line no-console\nconsole.log(1);", "src/demo.ts"),
    [],
  );
});
