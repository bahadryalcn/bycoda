import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { checkPackageBoundaries } from "./check-package-boundaries.mjs";

function fixture(run) {
  const root = mkdtempSync(path.join(tmpdir(), "bycoda-workspace-boundaries-"));
  const write = (name, content) => {
    const file = path.join(root, name);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, typeof content === "string" ? content : JSON.stringify(content));
  };
  const manifest = (extra = {}) => ({
    name: "@bycoda/example",
    private: true,
    exports: { ".": "./src/index.ts" },
    bycoda: { layer: "portable" },
    ...extra,
  });
  try {
    run({ root, write, manifest });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("traverses the complete portable public-export closure", () =>
  fixture(({ root, write, manifest }) => {
    write("packages/example/package.json", manifest());
    write("packages/example/src/index.ts", 'export {value} from "./utility.ts";');
    write("packages/example/src/utility.ts", "export const value=42;");
    const result = checkPackageBoundaries(root);
    assert.deepEqual(result.findings, []);
    assert.deepEqual(result.checked, [
      "packages/example/src/index.ts",
      "packages/example/src/utility.ts",
    ]);
  }));

test("rejects a platform dependency hidden behind multiple local modules", () =>
  fixture(({ root, write, manifest }) => {
    write("packages/example/package.json", manifest());
    write("packages/example/src/index.ts", 'export * from "./bridge.ts";');
    write("packages/example/src/bridge.ts", 'export * from "./platform.ts";');
    write("packages/example/src/platform.ts", 'export {readFile} from "node:fs";');
    const finding = checkPackageBoundaries(root).findings[0];
    assert.match(finding.message, /node:fs/);
    assert.deepEqual(finding.chain, [
      "packages/example/src/index.ts",
      "packages/example/src/bridge.ts",
    ]);
  }));

test("public exports cannot escape to legacy implementation roots", () =>
  fixture(({ root, write, manifest }) => {
    write("packages/example/package.json", manifest({ exports: { ".": "../../src/legacy.ts" } }));
    write("src/legacy.ts", "export const value=1;");
    assert.ok(
      checkPackageBoundaries(root).findings.some((item) =>
        /escaping public export/.test(item.message),
      ),
    );
  }));

test("a declared portable workspace dependency cannot smuggle its own UI dependency", () =>
  fixture(({ root, write, manifest }) => {
    write(
      "packages/example/package.json",
      manifest({ dependencies: { "@bycoda/other": "workspace:*" } }),
    );
    write("packages/example/src/index.ts", 'export * from "@bycoda/other";');
    write(
      "packages/other/package.json",
      manifest({ name: "@bycoda/other", dependencies: { react: "1.0.0" } }),
    );
    write("packages/other/src/index.ts", 'export {useState} from "react";');
    assert.ok(
      checkPackageBoundaries(root).findings.some((item) => /dependency: react/.test(item.message)),
    );
  }));

test("computed imports and undeclared/private package subpaths fail closed", () =>
  fixture(({ root, write, manifest }) => {
    write("packages/example/package.json", manifest());
    write("packages/example/src/index.ts", "export const load=(name:string)=>import(name);");
    assert.ok(
      checkPackageBoundaries(root).findings.some((item) => /Computed module/.test(item.message)),
    );
    write("packages/example/src/index.ts", 'export * from "@bycoda/example/private";');
    assert.ok(checkPackageBoundaries(root).findings.length > 0);
    write("packages/example/src/index.ts", '/// <reference types="node" />\nexport const value=1;');
    assert.ok(
      checkPackageBoundaries(root).findings.some((item) => /dependency: node/.test(item.message)),
    );
    write("packages/example/src/index.ts", '/// <reference lib="dom" />\nexport const value=1;');
    assert.ok(
      checkPackageBoundaries(root).findings.some((item) => /typescript-lib:dom/.test(item.message)),
    );
  }));

test("legacy paths may re-export canonical code but cannot retain a second implementation", () =>
  fixture(({ root, write, manifest }) => {
    write(
      "packages/example/package.json",
      manifest({ bycoda: { layer: "portable", legacyFacades: { "src/legacy.ts": "." } } }),
    );
    write("packages/example/src/index.ts", "export const value=1;");
    write("src/legacy.ts", 'export * from "@bycoda/example";');
    assert.deepEqual(checkPackageBoundaries(root).findings, []);
    write("src/legacy.ts", "export const value=1;");
    assert.ok(
      checkPackageBoundaries(root).findings.some((item) => /only re-export/.test(item.message)),
    );
  }));
