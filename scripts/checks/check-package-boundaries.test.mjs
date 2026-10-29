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

test("a private Rust workspace package declares its Cargo boundary rather than JS exports", () =>
  fixture(({ root, write, manifest }) => {
    write(
      "packages/example/package.json",
      manifest({
        exports: undefined,
        bycoda: { layer: "native", runtime: "rust", cargo: "./Cargo.toml" },
      }),
    );
    write("packages/example/Cargo.toml", '[package]\nname="example"\npublish=false\n');
    assert.deepEqual(checkPackageBoundaries(root).findings, []);
    write(
      "packages/example/package.json",
      manifest({
        bycoda: { layer: "native", runtime: "rust", cargo: "./Cargo.toml" },
      }),
    );
    assert.ok(checkPackageBoundaries(root).findings.some((item) => /Rust-only/.test(item.message)));
  }));

test("a native Node package permits real Node builtins while keeping UI and local edges bounded", () =>
  fixture(({ root, write, manifest }) => {
    write(
      "packages/example/package.json",
      manifest({
        exports: { ".": "./src/index.mjs" },
        bycoda: { layer: "native", runtime: "node", cargo: "./Cargo.toml" },
      }),
    );
    write("packages/example/Cargo.toml", '[package]\nname="example"\npublish=false\n');
    write("packages/example/src/index.mjs", 'export {readFile} from "node:fs/promises";');
    assert.deepEqual(checkPackageBoundaries(root).findings, []);
    for (const source of [
      'export {useState} from "react";',
      'export * from "node:does-not-exist";',
      'export * from "../../other.ts";',
    ]) {
      write("packages/example/src/index.mjs", source);
      assert.ok(checkPackageBoundaries(root).findings.length > 0, source);
    }
  }));

test("portable exports cannot acquire Node authority through a declared native dependency", () =>
  fixture(({ root, write, manifest }) => {
    write(
      "packages/example/package.json",
      manifest({ dependencies: { "@bycoda/bridge": "workspace:*" } }),
    );
    write("packages/example/src/index.ts", 'export * from "@bycoda/bridge";');
    write(
      "packages/bridge/package.json",
      manifest({
        name: "@bycoda/bridge",
        bycoda: { layer: "native", runtime: "node", cargo: "./Cargo.toml" },
      }),
    );
    write("packages/bridge/Cargo.toml", '[package]\nname="bridge"\npublish=false\n');
    write("packages/bridge/src/index.ts", 'export {readFile} from "node:fs";');
    assert.ok(
      checkPackageBoundaries(root).findings.some((item) =>
        /dependency: @bycoda\/bridge/.test(item.message),
      ),
    );
  }));

test("only the declared native artifact loader can load a computed CommonJS artifact", () =>
  fixture(({ root, write, manifest }) => {
    const bycoda = {
      layer: "native",
      runtime: "node",
      cargo: "./Cargo.toml",
      nativeLoader: "./src/index.mjs",
    };
    write(
      "packages/example/package.json",
      manifest({ exports: { ".": "./src/index.mjs" }, bycoda }),
    );
    write("packages/example/Cargo.toml", '[package]\nname="example"\npublish=false\n');
    write(
      "packages/example/src/index.mjs",
      'import {createRequire} from "node:module"; const require=createRequire(import.meta.url); export const load=(artifact)=>require(artifact);',
    );
    assert.deepEqual(checkPackageBoundaries(root).findings, []);
    write("packages/example/src/index.mjs", "export const load=(name)=>import(name);");
    assert.ok(
      checkPackageBoundaries(root).findings.some((item) => /Computed module/.test(item.message)),
    );
    write("packages/example/src/index.mjs", 'export * from "./helper.mjs";');
    write("packages/example/src/helper.mjs", "export const load=(name)=>require(name);");
    assert.ok(
      checkPackageBoundaries(root).findings.some((item) => /Computed module/.test(item.message)),
    );
    write(
      "packages/example/package.json",
      manifest({
        exports: { ".": "./src/index.mjs" },
        bycoda: { ...bycoda, nativeLoader: "../../outside.mjs" },
      }),
    );
    assert.ok(
      checkPackageBoundaries(root).findings.some((item) => /within its package/.test(item.message)),
    );
  }));

test("native metadata cannot substitute for a concrete local Cargo package", () =>
  fixture(({ root, write, manifest }) => {
    write("Cargo.toml", "[workspace]\nmembers=[]\n");
    for (const bycoda of [
      { layer: "native", runtime: "browser", cargo: "./Cargo.toml" },
      { layer: "native", runtime: "node", cargo: "../../Cargo.toml" },
      { layer: "native", runtime: "rust", cargo: "./Cargo.toml" },
    ]) {
      write("packages/example/package.json", manifest({ bycoda }));
      assert.ok(
        checkPackageBoundaries(root).findings.some((item) =>
          /local Cargo manifest/.test(item.message),
        ),
      );
    }
  }));

test("native helpers cannot conceal computed dependencies behind an aliased require factory", () =>
  fixture(({ root, write, manifest }) => {
    write(
      "packages/example/package.json",
      manifest({
        exports: { ".": "./src/index.mjs" },
        bycoda: {
          layer: "native",
          runtime: "node",
          cargo: "./Cargo.toml",
          nativeLoader: "./loader.mjs",
        },
      }),
    );
    write("packages/example/Cargo.toml", '[package]\nname="example"\npublish=false\n');
    write("packages/example/loader.mjs", "export const abi=1;");
    for (const source of [
      'import {createRequire} from "node:module"; const load=createRequire(import.meta.url); load("../../../src/app/"+"owner.js");',
      'import {createRequire as factory} from "module"; const load=factory(import.meta.url); load("../../../src/app/"+"owner.js");',
      'import * as modules from "node:module"; const load=modules.createRequire(import.meta.url); load("../../../src/app/"+"owner.js");',
      'export {createRequire} from "node:module";',
    ]) {
      write("packages/example/src/index.mjs", source);
      assert.ok(
        checkPackageBoundaries(root).findings.some((item) =>
          /module loading helpers/.test(item.message),
        ),
        source,
      );
    }
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
