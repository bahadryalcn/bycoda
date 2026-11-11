import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  baselineFile,
  compareCounts,
  compiledFolders,
  countsOf,
  formatRegressions,
  listSources,
  rule,
  scanSource,
} from "./check-compiler-coverage.mjs";

const file = "src/shared/ui/Demo.tsx";

test("a plain component and hook compile", async () => {
  const { compiled, skipped } = await scanSource(
    file,
    [
      'import { useState } from "react";',
      "export function useCount() { const [count, setCount] = useState(0); return { count, setCount }; }",
      "export function Demo({ label }: { label: string }) { const { count } = useCount(); return <p>{label}{count}</p>; }",
    ].join("\n"),
  );
  assert.equal(compiled, 2);
  assert.deepEqual(skipped, []);
});

test("a render that reads the clock is skipped by the guard, with its line", async () => {
  const { compiled, skipped } = await scanSource(
    file,
    [
      "export function Fine() { return <p>ok</p>; }",
      "export function Stamp() { const now = Date.now(); return <p>{now}</p>; }",
    ].join("\n"),
  );
  assert.equal(compiled, 1);
  assert.equal(skipped.length, 1);
  assert.equal(skipped[0].line, 2);
  assert.match(skipped[0].reason, /^guard: Date\.now/);
});

test("code the compiler cannot prove safe is skipped once per function", async () => {
  const { skipped } = await scanSource(
    file,
    [
      'import { useRef } from "react";',
      "export function Reads() { const ref = useRef(0); return <p>{ref.current}</p>; }",
    ].join("\n"),
  );
  assert.equal(skipped.length, 1);
  assert.match(skipped[0].reason, /^compiler: /);
});

test("only a count above the baseline fails; a lower one is an improvement", () => {
  const skipped = (count) => Array.from({ length: count }, (_, line) => ({ line, reason: "x" }));
  const scan = {
    "a.tsx": { compiled: 1, skipped: skipped(2) },
    "b.tsx": { compiled: 1, skipped: skipped(1) },
    "c.tsx": { compiled: 3, skipped: [] },
    "d.tsx": { compiled: 0, skipped: skipped(1) },
  };
  const baseline = { "a.tsx": { [rule]: 2 }, "b.tsx": { [rule]: 3 } };
  const { regressions, improvements } = compareCounts(scan, baseline);
  assert.deepEqual(
    regressions.map(({ file: name, allowed }) => [name, allowed]),
    [["d.tsx", 0]],
  );
  assert.deepEqual(improvements, [{ file: "b.tsx", allowed: 3, now: 1 }]);
  assert.match(formatRegressions(regressions), /d\.tsx: 1 functions do not compile \(baseline 0\)/);
  assert.deepEqual(Object.keys(countsOf(scan)), ["a.tsx", "b.tsx", "d.tsx"]);
});

test("the compiled folders match the build and the baseline names existing sources", () => {
  const build = fs.readFileSync("scripts/build/react-compiler.ts", "utf8");
  const pattern = /const INFERRED =\s*\/(.+)\/;/.exec(build)?.[1] ?? "";
  for (const folder of compiledFolders)
    assert.ok(pattern.includes(folder.replace(/^src\//, "").replaceAll("/", "[\\\\/]")), folder);
  const sources = new Set(listSources());
  const { counts } = JSON.parse(fs.readFileSync(baselineFile, "utf8"));
  for (const name of Object.keys(counts)) assert.ok(sources.has(name), name);
});
