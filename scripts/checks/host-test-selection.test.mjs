import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { hostTestSelection, portableHostTests } from "./host-test-selection.mjs";

test("only unchanged reviewed graphs move out of all-OS integration coverage", () => {
  const root = mkdtempSync(join(tmpdir(), "bycoda-host-selection-"));
  try {
    mkdirSync(join(root, "host"));
    const source = "export const value = 1;\n";
    const hash = createHash("sha256").update(source).digest("hex");
    writeFileSync(join(root, "host/pure.test.ts"), source.replaceAll("\n", "\r\n"));
    writeFileSync(join(root, "host/pure.ts"), source);
    const manifest = {
      schemaVersion: 1,
      tests: [
        {
          file: "host/pure.test.ts",
          sources: {
            "host/pure.test.ts": hash,
            "host/pure.ts": hash,
          },
        },
      ],
    };
    assert.deepEqual(portableHostTests(root, manifest), ["host/pure.test.ts"]);
    assert.deepEqual(hostTestSelection("portable", root, manifest).include, ["host/pure.test.ts"]);
    assert.deepEqual(hostTestSelection("integration", root, manifest).exclude, [
      "host/pure.test.ts",
    ]);
    // A new OS import anywhere in the reviewed graph invalidates the review.
    writeFileSync(join(root, "host/pure.ts"), 'import os from "node:os";\n');
    assert.deepEqual(portableHostTests(root, manifest), []);
    assert.deepEqual(hostTestSelection("integration", root, manifest).exclude, []);
    rmSync(join(root, "host/pure.ts"));
    assert.deepEqual(portableHostTests(root, manifest), []);
    assert.deepEqual(hostTestSelection("all", root, manifest), {
      include: ["host/**/*.test.ts"],
      exclude: [],
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("invalid scopes and ambiguous or escaping review entries fail closed", () => {
  assert.throws(() => hostTestSelection("integation"), /Unknown/);
  assert.throws(() => portableHostTests(".", { schemaVersion: 2, tests: [] }), /Invalid/);
  const entry = { file: "host/x.test.ts", sources: { "host/x.test.ts": "digest" } };
  assert.throws(
    () => portableHostTests(".", { schemaVersion: 1, tests: [entry, entry] }),
    /duplicate/,
  );
  assert.throws(
    () =>
      portableHostTests(".", {
        schemaVersion: 1,
        tests: [
          {
            file: "host/x.test.ts",
            sources: { "../outside": "digest", "host/x.test.ts": "digest" },
          },
        ],
      }),
    /escapes/,
  );
});

test("the maintained manifest selects only unique Host test paths", () => {
  const selected = portableHostTests();
  assert(selected.every((file) => /^host\/.+\.test\.ts$/.test(file)));
  assert.equal(new Set(selected).size, selected.length);
});
