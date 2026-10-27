import assert from "node:assert/strict";
import test from "node:test";
import { reviewQualityPatterns } from "./quality-patterns.mjs";

test("reports an unexplained suppression but accepts a narrow inline rationale", () => {
  const text =
    "// oxlint-disable-next-line no-explicit-any\nconst value: any = 1;\n// @ts-expect-error -- Deliberately malformed external input exercises recovery.\nconst other: string = 1;";
  assert.deepEqual(
    reviewQualityPatterns(text, "src/demo.ts").map(({ rule, line }) => ({ rule, line })),
    [{ rule: "suppression-reason-review", line: 1 }],
  );
});

test("does not interpret example strings as suppression comments", () => {
  assert.deepEqual(
    reviewQualityPatterns('const example = "// oxlint-disable no-console";', "src/demo.ts"),
    [],
  );
  assert.deepEqual(
    reviewQualityPatterns("const example = /\\/\\/ oxlint-disable no-console/;", "src/demo.ts"),
    [],
  );
  assert.deepEqual(
    reviewQualityPatterns(
      "const example = `part ${1}\n// oxlint-disable no-console`;",
      "src/demo.ts",
    ),
    [],
  );
});

test("tolerates incomplete TSX without rewinding over zero-width recovered literals", () => {
  const result = reviewQualityPatterns(
    "const view = <div title= />;\n// oxlint-disable no-console",
    "src/demo.tsx",
  );
  assert.equal(result[0]?.rule, "suppression-reason-review");
});

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
