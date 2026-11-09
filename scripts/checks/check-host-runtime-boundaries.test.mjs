import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { checkHostRuntimeBoundaries } from "./check-host-runtime-boundaries.mjs";

const core = "src/shared/lib/host-runtime";
function fixture(t, files) {
  const prefix = "bycoda-host-runtime-boundaries-";
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  for (const [name, text] of Object.entries(files)) {
    const file = path.join(root, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  }
  t.after(() => {
    const resolved = fs.realpathSync(root);
    assert.equal(path.dirname(resolved), fs.realpathSync(os.tmpdir()));
    assert(
      path.basename(resolved).startsWith(prefix),
      "Only this test's verified temporary root may be removed",
    );
    fs.rmSync(resolved, { recursive: true, force: true });
  });
  return root;
}

test("accepts portable cycles, zod, aliases, JSON and type-only contracts without parsing comments as imports", (t) => {
  const root = fixture(t, {
    "tsconfig.json": JSON.stringify({
      compilerOptions: { baseUrl: ".", paths: { "@/*": ["src/*"] } },
    }),
    [`${core}/index.ts`]: `import { z } from "zod";
      import type { Identity } from "@/shared/model/host-contracts/types";
      export { helper } from "../pure";
      const example = 'import React from "react"';
      // require("node:fs") and import("expo") are examples, not calls.
      export const value = example;`,
    "src/shared/model/host-contracts/types.ts": "export type Identity = { id: string };",
    "src/shared/lib/pure.ts":
      'export { value } from "./host-runtime"; import data from "./data.json"; export const helper = data;',
    "src/shared/lib/data.json": '{"safe":true}',
    [`${core}/ignored.test.ts`]: 'import fs from "node:fs";',
  });
  const result = checkHostRuntimeBoundaries({ root });
  assert.equal(result.ok, true, JSON.stringify(result.findings));
  assert(result.checkedFiles.includes("src/shared/lib/data.json"));
  assert(!result.checkedFiles.some((name) => name.endsWith("ignored.test.ts")));
});

test("reports a transitive unsafe helper with its source chain", (t) => {
  const root = fixture(t, {
    [`${core}/index.ts`]: 'export { unsafe } from "../helper";',
    "src/shared/lib/helper.ts":
      'import { readFile } from "node:fs/promises"; export const unsafe = readFile;',
  });
  const result = checkHostRuntimeBoundaries({ root });
  assert.equal(result.ok, false);
  assert.equal(result.findings[0].specifier, "node:fs/promises");
  assert.deepEqual(result.findings[0].chain, [`${core}/index.ts`, "src/shared/lib/helper.ts"]);
});

test("finds literal dynamic imports, CommonJS imports, reexports and type-only import expressions", (t) => {
  const root = fixture(t, {
    [`${core}/index.ts`]: `export type Bad = import("react").ReactNode;
      export const dynamic = () => import("expo-secure-store");
      const data = require("fs");
      export * from "@tauri-apps/api/core";
      import platform = require("node:path");`,
  });
  const result = checkHostRuntimeBoundaries({ root });
  assert.deepEqual(result.findings.map((finding) => finding.specifier).sort(), [
    "@tauri-apps/api/core",
    "expo-secure-store",
    "fs",
    "node:path",
    "react",
  ]);
});

test("fails unresolved local edges and computed module loading", (t) => {
  const root = fixture(t, {
    [`${core}/index.ts`]:
      'import "./missing"; const moduleName = "./helper"; export const load = () => import(moduleName);',
  });
  const result = checkHostRuntimeBoundaries({ root });
  assert.deepEqual(
    new Set(result.findings.map((finding) => finding.kind)),
    new Set(["unresolved-import", "computed-import"]),
  );
});

test("does not mistake a locally bound require helper for CommonJS loading", (t) => {
  const root = fixture(t, {
    [`${core}/index.ts`]:
      'function require(value: string) { return value; } export const check = require("plain text"); export const nested = (require: (v: string) => string) => require("other text");',
  });
  assert.equal(checkHostRuntimeBoundaries({ root }).ok, true);
});

test("rejects implicit JSX runtime dependencies without a written React import", (t) => {
  const root = fixture(t, {
    [`${core}/view.tsx`]: "export const render = () => <div />;",
  });
  const result = checkHostRuntimeBoundaries({ root });
  assert.equal(result.ok, false);
  assert.equal(result.findings[0].specifier, "implicit-jsx-runtime");
});

test("rejects renderer/platform and host implementation traversal even for type-only imports", (t) => {
  const root = fixture(t, {
    [`${core}/index.ts`]:
      'import type { UI } from "@/features/state"; export { native } from "@/platform/native";',
    "src/features/state.ts": "export type UI = string;",
    "src/platform/native.ts": "export const native = 1;",
    "host/domains/sessions/service.ts":
      'import type { State } from "../../transport/state"; export { engine } from "../../engine";',
    "host/transport/state.ts": "export type State = string;",
    "host/engine.ts": "export const engine = 1;",
  });
  const result = checkHostRuntimeBoundaries({ root });
  assert.equal(result.findings.length, 4);
  assert(result.findings.every((finding) => finding.kind === "forbidden-import"));
});

test("accepts domain ports and neutral DTOs, while detecting unsafe transitive domain helpers", (t) => {
  const root = fixture(t, {
    "host/domains/sessions/service.ts":
      'import type { Store } from "./ports/store"; import type { Wire } from "../../../src/shared/model/host-contracts/wire"; export const run = 1;',
    "host/domains/sessions/ports/store.ts": "export interface Store { get(): Promise<string>; }",
    "src/shared/model/host-contracts/wire.ts": "export type Wire = { id: string };",
  });
  assert.equal(checkHostRuntimeBoundaries({ root }).ok, true);
  fs.writeFileSync(
    path.join(root, "host/domains/sessions/ports/store.ts"),
    'import { request } from "node:http"; export const store = request;',
  );
  const result = checkHostRuntimeBoundaries({ root });
  assert.equal(result.ok, false);
  assert.equal(result.findings[0].specifier, "node:http");
});

test("production imports of tests, native-named files and DOM reference libraries fail closed", (t) => {
  const root = fixture(t, {
    [`${core}/index.ts`]: 'export * from "./helper.test"; export * from "../process.node";',
    [`${core}/helper.test.ts`]: "export const helper = 1;",
    "src/shared/lib/process.node.ts": "export const process = 1;",
    [`${core}/types.d.ts`]: '/// <reference lib="dom" />\nexport interface View {}',
  });
  const result = checkHostRuntimeBoundaries({ root });
  assert.equal(result.findings.length, 3);
  assert(result.findings.some((finding) => finding.specifier === "typescript-lib:dom"));
});
