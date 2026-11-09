import assert from "node:assert/strict";
import test from "node:test";
import { summarizeUsage } from "./repository-usage.mjs";

const fixture = () => ({
  scope: "static production fixture",
  nodes: [
    { path: "src/main.ts", owner: "entry" },
    { path: "src/used.ts", owner: "shared" },
    { path: "host/embedded.ts", owner: "host" },
    { path: "src/registered.ts", owner: "feature" },
  ],
  edges: [{ from: "src/main.ts", to: "src/used.ts" }],
  nativeEmbeds: [
    { from: "src-tauri/main.rs", to: "host/embedded.ts", state: "present" },
    { from: "src-tauri/main.rs", to: null, state: "generated-or-computed" },
  ],
  externalPackages: ["react", "@scope/used"],
  unresolved: [{ from: "src/main.ts", reason: "computed module loading" }],
});

test("omits statically consumed and literal embedded modules but leaves entry/runtime candidates reviewable", () => {
  const report = summarizeUsage(fixture(), {
    dependencies: { react: "1", "@scope/used": "1", "build-only": "1", "platform-plugin": "1" },
    devDependencies: { vitest: "1" },
  });
  assert.deepEqual(
    report.modulesWithoutInventoriedIncomingImports.map((item) => item.path),
    ["src/main.ts", "src/registered.ts"],
  );
  assert.deepEqual(report.dependenciesAbsentFromProductionImportInventory, [
    "build-only",
    "platform-plugin",
  ]);
  assert.equal(report.counts.unresolvedImports, 1);
  assert.equal(report.nativeEmbeds[0].state, "generated-or-computed");
  assert(report.limitations.some((item) => item.includes("No unused-export claim")));
  assert(!("pass" in report));
});

test("a new real incoming edge removes only that candidate; removing an import adds it back", () => {
  const inventory = fixture();
  inventory.edges.push({ from: "src/main.ts", to: "src/registered.ts" });
  assert.deepEqual(
    summarizeUsage(inventory, {}).modulesWithoutInventoriedIncomingImports.map((item) => item.path),
    ["src/main.ts"],
  );
  inventory.edges = [];
  assert.deepEqual(
    summarizeUsage(inventory, {}).modulesWithoutInventoriedIncomingImports.map((item) => item.path),
    ["src/main.ts", "src/used.ts", "src/registered.ts"],
  );
});

test("missing production references never become an automatic removal recommendation", () => {
  const report = summarizeUsage(
    {
      scope: "empty",
      nodes: [],
      edges: [],
      nativeEmbeds: [],
      externalPackages: [],
      unresolved: [],
    },
    { dependencies: { "cli-only": "1" } },
  );
  assert.deepEqual(report.dependenciesAbsentFromProductionImportInventory, ["cli-only"]);
  assert(report.limitations.some((item) => item.includes("CLI/bin/peer/optional/platform")));
  assert(report.mode.includes("no deletion"));
});
