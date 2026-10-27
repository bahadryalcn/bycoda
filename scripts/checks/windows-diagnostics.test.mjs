import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { diagnosticPlan, diagnosticOptions, runDiagnostic } from "./windows-diagnostics.mjs";

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bycoda-windows-diagnostic-"));
  for (const name of [
    "host/demo.test.ts",
    "src/demo.test.ts",
    "scripts/checks/demo.test.mjs",
    "scripts/build/host-inputs.test.mjs",
    "scripts/local-update/test_demo.py",
  ]) {
    const file = path.join(root, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "synthetic test");
  }
  t.after(() => {
    assert.equal(path.dirname(fs.realpathSync(root)), fs.realpathSync(os.tmpdir()));
    assert(path.basename(root).startsWith("bycoda-windows-diagnostic-"));
    fs.rmSync(root, { recursive: true, force: true });
  });
  return root;
}
const source = () => ({ gitSha: "a".repeat(40), dirty: false, selectedFileSha256: "b".repeat(64) });

test("recipes select exactly one allowlisted test file and use argument arrays without a shell", (t) => {
  const root = fixture(t);
  for (const [suite, file] of [
    ["host", "host/demo.test.ts"],
    ["web", "src/demo.test.ts"],
    ["scripts", "scripts/checks/demo.test.mjs"],
    ["package-contracts", "scripts/build/host-inputs.test.mjs"],
    ["local-update", "scripts/local-update/test_demo.py"],
  ]) {
    const plan = diagnosticPlan({ suite, file }, root);
    assert(
      plan.args.includes(file) ||
        plan.args.includes(path.join(root, file)) ||
        plan.args.includes("test_demo.py"),
    );
    assert(!plan.args.some((argument) => argument.includes("&&")));
  }
});
test("rejects unknown suites, shell injection, traversal, mismatched owners and unbounded timeouts", (t) => {
  const root = fixture(t);
  for (const args of [
    { suite: "shell", file: "host/demo.test.ts" },
    { suite: "host", file: "host/demo.test.ts;whoami" },
    { suite: "host", file: "../host/demo.test.ts" },
    { suite: "host", file: "src/demo.test.ts" },
    { suite: "host", file: "host/demo.test.ts", timeoutMs: 600001 },
  ])
    assert.throws(() => diagnosticPlan(args, root));
  assert.throws(() => diagnosticOptions(["--command", "whoami"]));
  assert.throws(() => diagnosticOptions(["--run", "--run"]));
});
test("default plan does not execute; explicit Windows run retains source identity and raw logs", (t) => {
  const root = fixture(t);
  let calls = 0;
  const run = (_command, _args, config) => {
    calls++;
    assert.equal(config.shell, false);
    assert.equal(config.windowsHide, true);
    return { status: 0, stdout: Buffer.from("raw stdout\n"), stderr: Buffer.from("raw stderr\n") };
  };
  const args = {
    suite: "scripts",
    file: "scripts/checks/demo.test.mjs",
    output: "temp/verification/diagnostic/run",
  };
  assert.equal(runDiagnostic(args, { root, source, run }).status, "plan-only");
  assert.equal(calls, 0);
  const report = runDiagnostic({ ...args, run: true }, { root, platform: "win32", source, run });
  assert.equal(report.status, "passed");
  assert.equal(calls, 1);
  assert.equal(fs.readFileSync(path.join(root, args.output, "stdout.log"), "utf8"), "raw stdout\n");
  assert.throws(
    () => runDiagnostic({ ...args, run: true }, { root, platform: "win32", source, run }),
    /Existing/,
  );
});
test("timeouts, failure, source drift and non-Windows hosts never become Windows success", (t) => {
  const root = fixture(t);
  const args = { suite: "scripts", file: "scripts/checks/demo.test.mjs", run: true };
  assert.throws(() =>
    runDiagnostic(
      { ...args, output: "temp/verification/nonwindows" },
      { root, platform: "linux", source },
    ),
  );
  for (const [name, result, expected] of [
    ["fail", { status: 1 }, "failed"],
    ["timeout", { status: null, error: { code: "ETIMEDOUT" } }, "timed-out"],
    ["missing", { status: null, error: { code: "ENOENT" } }, "execution-error"],
  ])
    assert.equal(
      runDiagnostic(
        { ...args, output: `temp/verification/${name}` },
        { root, platform: "win32", source, run: () => result },
      ).status,
      expected,
    );
  let generation = 0;
  assert.equal(
    runDiagnostic(
      { ...args, output: "temp/verification/drift" },
      {
        root,
        platform: "win32",
        source: () => ({ generation: generation++ }),
        run: () => ({ status: 0 }),
      },
    ).status,
    "source-drift",
  );
  assert.throws(() =>
    runDiagnostic({ ...args, output: "../outside" }, { root, platform: "win32", source }),
  );
});
