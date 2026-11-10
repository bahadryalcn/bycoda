import assert from "node:assert/strict";
import test from "node:test";
import {
  compare,
  countPerFile,
  parseDiagnostics,
  ratchet,
  runProject,
  topFolder,
} from "./check-test-types.mjs";

const output = [
  "src/a/x.test.ts(3,5): error TS2322: Type 'string' is not assignable to type 'number'.",
  "  Types of property 'harness' are incompatible.",
  "src\\a\\x.test.ts(9,1): error TS7006: Parameter 'p' implicitly has an 'any' type.",
  "host/b/y.test.ts(1,1): error TS2339: Property 'z' does not exist.",
  "Found 3 errors.",
].join("\r\n");

test("launches the Unix compiler executable separately from its arguments", () => {
  const result = runProject("tsconfig.tests.json", "linux", (bin, args, options) => {
    assert.match(bin.replaceAll("\\", "/"), /\/node_modules\/\.bin\/tsc-rs$/);
    assert.deepEqual(args, ["--noEmit", "--pretty", "false", "-p", "tsconfig.tests.json"]);
    assert.equal(options.shell, undefined);
    return { status: 0, stdout: "", stderr: "" };
  });
  assert.deepEqual(result, []);
});

test("uses one quoted Windows command for the compiler cmd shim", () => {
  runProject("host/tsconfig.tests.json", "win32", (command, options) => {
    assert.match(
      command,
      /^".+tsc-rs\.cmd" --noEmit --pretty false -p host\/tsconfig\.tests\.json$/,
    );
    assert.equal(options.shell, true);
    return { status: 0, stdout: "", stderr: "" };
  });
});

test("parses diagnostics, skips continuation lines and normalizes separators", () => {
  const found = parseDiagnostics(output);
  assert.deepEqual(
    found.map((d) => [d.file, d.code]),
    [
      ["src/a/x.test.ts", "TS2322"],
      ["src/a/x.test.ts", "TS7006"],
      ["host/b/y.test.ts", "TS2339"],
    ],
  );
  assert.deepEqual(countPerFile(found), { "src/a/x.test.ts": 2, "host/b/y.test.ts": 1 });
});

test("accepts equal and lower counts", () => {
  assert.deepEqual(compare({ "a/x.test.ts": 2 }, { "a/x.test.ts": 2 }), []);
  assert.deepEqual(compare({ "a/x.test.ts": 1 }, { "a/x.test.ts": 2 }), []);
});

test("rejects an increase and a new test file with errors", () => {
  assert.equal(compare({ "a/x.test.ts": 3 }, { "a/x.test.ts": 2 })[0].allowed, 2);
  assert.equal(compare({ "a/new.test.tsx": 1 }, {})[0].allowed, 0);
});

test("rejects any error in a non-test file even when baselined", () => {
  const [r] = compare({ "src/a/util.ts": 1 }, { "src/a/util.ts": 5 });
  assert.equal(r.reason, "non-test file");
});

test("ratchet only lowers and drops cleared files", () => {
  assert.deepEqual(
    ratchet({ "a.test.ts": 1, "b.test.ts": 9 }, { "a.test.ts": 3, "b.test.ts": 4, "c.test.ts": 2 }),
    { "a.test.ts": 1, "b.test.ts": 4 },
  );
});

test("groups files by top folder", () => {
  assert.equal(topFolder("src/features/sessions/x.test.ts"), "src/features/sessions");
  assert.equal(topFolder("host/assistant/x.test.ts"), "host/assistant");
  assert.equal(topFolder("host/x.test.ts"), "host");
});
