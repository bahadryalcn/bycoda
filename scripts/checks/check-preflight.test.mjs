import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { preflightGates, preflightOptions, runPreflight, selectGates } from "./check-preflight.mjs";

test("preflight mirrors the cheap CI gates that failed main after local checks passed", () => {
  const commands = preflightGates.map((gate) => gate.command.join(" "));
  for (const expected of [
    "oxfmt --check .",
    "cargo fmt --all --check",
    "evals/tsconfig.json",
    "check-lint-baseline.mjs",
    "check-code-structure.mjs",
    "ui-catalog.mjs",
    "check-baselines.mjs",
    "check-test-types.mjs",
    "browser-test-inventory.mjs --check",
    "tests/browser/tsconfig.json",
  ])
    assert(
      commands.some((command) => command.includes(expected)),
      expected,
    );
  const workflow = readFileSync(new URL("../../.github/workflows/ci.yml", import.meta.url), "utf8");
  for (const script of [
    "format:check",
    "lint:baseline",
    "check:locales",
    "check:feature-skills",
    "check:colors",
    "check:ui-drift",
    "check:structure",
    "check:ui-catalog",
    "check:baselines",
    "check:types:tests",
  ])
    assert(workflow.includes(script), `CI no longer runs ${script}; update the preflight mirror`);
  assert(
    !commands.some((command) => / install|playwright|cargo (?:test|clippy|build)/.test(command)),
  );
});

test("selection is explicit and argument mistakes never narrow coverage silently", () => {
  assert.deepEqual(
    [...new Set(selectGates(preflightGates, { only: ["preflight"] }).map((gate) => gate.job))],
    ["preflight"],
  );
  assert(!selectGates(preflightGates, { skipSlow: true }).some((gate) => gate.slow));
  assert.throws(() => selectGates(preflightGates, { only: ["typo"] }), /Unknown CI job/);
  assert.throws(() => preflightOptions(["--only"]));
  assert.throws(() => preflightOptions(["--concurrency", "0"]));
  assert.throws(() => preflightOptions(["--unknown"]));
  assert.deepEqual(preflightOptions(["--only", "scripts,browser"]).only, ["scripts", "browser"]);
});

test("every gate runs even after an earlier failure and failures keep their output", async () => {
  const gates = [
    {
      job: "a",
      name: "fails",
      command: [process.execPath, "-e", "console.error('broken'); process.exit(3)"],
    },
    { job: "b", name: "passes", command: [process.execPath, "-e", "console.log('fine')"] },
    { job: "c", name: "missing", command: ["bycoda-definitely-missing-command"] },
  ];
  const results = await runPreflight(gates, {
    root: process.cwd(),
    concurrency: 1,
    timeoutMs: 30000,
  });
  assert.deepEqual(
    results.map((result) => result.exitCode !== 0),
    [true, false, true],
  );
  assert.match(results[0].output, /broken/);
});

test("a hung gate is stopped at its deadline and reported as timed out", async () => {
  const [result] = await runPreflight(
    [{ job: "a", name: "hangs", command: [process.execPath, "-e", "setInterval(() => {}, 1000)"] }],
    { root: process.cwd(), concurrency: 1, timeoutMs: 300 },
  );
  assert.equal(result.timedOut, true);
});
