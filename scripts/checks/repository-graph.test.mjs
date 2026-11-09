import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { inventoryRepository } from "./repository-graph.mjs";

test("maps actual shared consumers, type/dynamic edges and embedded native inputs", () => {
  const root = mkdtempSync(path.join(tmpdir(), "bycoda-graph-"));
  const put = (name, text) => {
    mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    writeFileSync(path.join(root, name), text);
  };
  try {
    put(
      "host/main.ts",
      'import type { X } from "../src/shared/model/host-contracts/types"; import("@/shared/lib/host-runtime/run"); import("node:fs"); import(next);',
    );
    put("src/shared/model/host-contracts/types.ts", "export type X = string;");
    put("src/shared/lib/host-runtime/run.ts", "export const run = () => 1;");
    put("src/example.test.ts", 'import "./missing-test-only";');
    put("host/windows-acl.ps1", "# fixture");
    put(
      "src-tauri/src/ssh.rs",
      'const ACL: &str = include_str!("../../host/windows-acl.ps1"); const GENERATED: &str = include_str!(concat!(env!("OUT_DIR"), "/manifest.json"));',
    );
    const report = inventoryRepository(root);
    assert.equal(report.nodes.length, 3);
    assert.deepEqual(report.hostSourceImports.map((edge) => edge.toOwner).sort(), [
      "contracts",
      "portable-runtime",
    ]);
    assert.equal(report.unresolved[0].reason, "computed module loading");
    assert.deepEqual(
      report.nativeEmbeds.map((edge) => edge.state),
      ["present", "generated-or-computed"],
    );
    assert.ok(report.externalPackages.includes("node:fs"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("reports missing imports and embeds without silently declaring coverage complete", () => {
  const root = mkdtempSync(path.join(tmpdir(), "bycoda-graph-"));
  try {
    mkdirSync(path.join(root, "host"));
    mkdirSync(path.join(root, "src-tauri/src"), { recursive: true });
    writeFileSync(path.join(root, "host/main.ts"), 'export { missing } from "./missing";');
    writeFileSync(path.join(root, "src-tauri/src/main.rs"), 'include_bytes!("missing.bin");');
    const report = inventoryRepository(root);
    assert.equal(report.unresolved[0].reason, "unresolved local import");
    assert.equal(report.nativeEmbeds[0].state, "missing");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("inventories canonical workspace modules and app bootstraps, resolving only public package exports", () => {
  const root = mkdtempSync(path.join(tmpdir(), "bycoda-workspace-graph-"));
  const put = (name, text) => {
    mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    writeFileSync(path.join(root, name), text);
  };
  try {
    put(
      "packages/core/package.json",
      JSON.stringify({ name: "@bycoda/core", exports: { "./helper": "./src/helper.ts" } }),
    );
    put("packages/core/src/helper.ts", "export const helper=1;");
    put("packages/core/dist/generated.js", "export const duplicate=1;");
    put(
      "host/main.ts",
      'import {helper} from "@bycoda/core/helper"; import "@bycoda/core/private";',
    );
    put("apps/desktop/package.json", JSON.stringify({ name: "@bycoda/desktop", private: true }));
    put("apps/desktop/src/main.ts", 'import "../../../src/legacy";');
    put("src/legacy.ts", "export const app=1;");
    const report = inventoryRepository(root);
    assert.ok(
      report.nodes.some(
        (node) => node.path === "packages/core/src/helper.ts" && node.owner === "portable-package",
      ),
    );
    assert.ok(
      report.nodes.some(
        (node) => node.path === "apps/desktop/src/main.ts" && node.owner === "desktop-bootstrap",
      ),
    );
    assert.ok(!report.nodes.some((node) => node.path.includes("/dist/")));
    assert.ok(
      report.edges.some(
        (edge) => edge.from === "host/main.ts" && edge.to === "packages/core/src/helper.ts",
      ),
    );
    assert.ok(report.unresolved.some((edge) => edge.specifier === "@bycoda/core/private"));
    assert.deepEqual(report.workspacePackages, ["@bycoda/core", "@bycoda/desktop"]);
    assert.deepEqual(report, inventoryRepository(root));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
