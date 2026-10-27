import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { classifyChanges, detectChanges, gates, optionsFromArguments } from "./ci-changes.mjs";
import { localOptions, localPlan, localSourceIdentity, scriptTestFiles } from "./check-local.mjs";
import { inventoryRepository } from "./repository-graph.mjs";

test("docs are inert; shared application/native/fixture inputs keep their real dependents", () => {
  assert(gates.every((gate) => !classifyChanges(["docs/guides/chat.md"]).gates[gate]));
  for (const file of [
    "src/shared/model/host-contracts/generated/manifest.json",
    "src/features/social/model/socialClient.ts",
    "host/windows-acl.ps1",
  ]) {
    const result = classifyChanges([file]);
    for (const gate of ["web", "host", "native", "rpm", "browser"])
      assert.equal(result.gates[gate], true, `${file}: ${gate}`);
  }
  assert.equal(classifyChanges(["src-tauri/src/remote.rs"]).gates.native, true);
  assert.equal(classifyChanges(["src-tauri/src/remote.rs"]).gates.scripts, true);
  assert.equal(classifyChanges(["tests/browser/notes.spec.ts"]).gates.browser, true);
  assert.equal(classifyChanges(["scripts/local-update/local_update.py"]).gates.python, true);
  assert(gates.every((gate) => classifyChanges(["pnpm-lock.yaml"]).gates[gate]));
  assert(gates.every((gate) => classifyChanges([".github/workflows/ci.yml"]).gates[gate]));
  for (const file of ["src/app/shell/Sidebar.tsx", "host/notes.ts", "public/brand/logo.svg"]) {
    const result = classifyChanges([file]);
    assert.equal(result.gates.web, true);
    assert.equal(result.gates.host, true);
    assert.equal(result.gates.native, false, file);
    assert.equal(result.gates.rpm, false, file);
  }
});

test("every literal Rust include outside src-tauri keeps native and package checks selected", () => {
  for (const embed of inventoryRepository().nativeEmbeds) {
    if (!embed.to || embed.to.startsWith("src-tauri/")) continue;
    const result = classifyChanges([embed.to]);
    assert.equal(result.gates.native, true, `${embed.from} -> ${embed.to}`);
    assert.equal(result.gates.rpm, true, `${embed.from} -> ${embed.to}`);
  }
});

test("unknown, malformed or unavailable changes fail open; mobile stays independent", () => {
  for (const input of [
    null,
    42,
    "not-a-file-list",
    ["new-domain/schema.json"],
    ["../escape"],
    ["/absolute"],
    ["C:/absolute"],
    [null],
  ]) {
    assert(gates.every((gate) => classifyChanges(input).gates[gate]));
  }
  assert(gates.every((gate) => !classifyChanges(["mobile/src/example.test.ts"]).gates[gate]));
  assert(gates.every((gate) => classifyChanges([], { full: true }).gates[gate]));
});

test("Git detection includes renamed old/new paths, deleted files, staged and untracked work", (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "bycoda-ci-diff-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8", windowsHide: true });
  git("init", "-q");
  git("config", "user.name", "Fixture");
  git("config", "user.email", "fixture@example.test");
  git("config", "commit.gpgsign", "false");
  mkdirSync(path.join(root, "docs"));
  mkdirSync(path.join(root, "host"));
  writeFileSync(path.join(root, "docs", "before name.md"), "fixture");
  writeFileSync(path.join(root, "host", "deleted.ts"), "fixture");
  git("add", ".");
  git("commit", "-qm", "fixture baseline");
  const base = git("rev-parse", "HEAD").trim();
  assert.deepEqual(localSourceIdentity(root), { sourceSha: base, sourceDirty: false });
  renameSync(path.join(root, "docs", "before name.md"), path.join(root, "host", "after name.ts"));
  rmSync(path.join(root, "host", "deleted.ts"));
  git("add", "-A");
  writeFileSync(path.join(root, "host", "untracked.ts"), "fixture");
  assert.deepEqual(localSourceIdentity(root), { sourceSha: base, sourceDirty: true });
  const result = detectChanges({ root, base });
  assert.deepEqual(result.files, [
    "docs/before name.md",
    "host/after name.ts",
    "host/deleted.ts",
    "host/untracked.ts",
  ]);
  assert.equal(result.gates.host, true);
  assert.equal(result.sourceSha, base);
  const failedDiff = detectChanges({ root, base: "missing-reference" });
  const main = detectChanges({ root, ci: true, event: "push" });
  const manual = detectChanges({ root, ci: true, event: "workflow_dispatch" });
  assert(gates.every((gate) => failedDiff.gates[gate]));
  assert(gates.every((gate) => main.gates[gate]));
  assert(gates.every((gate) => manual.gates[gate]));
});

test("bounded local plans share classification but never promise full acceptance or install dependencies", (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "bycoda-local-plan-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [file, content] of Object.entries({
    "scripts/release/candidate.mjs": "export const value = 1;",
    "scripts/release/candidate.test.mjs": "fixture test",
    "scripts/release/candidate.failure.test.mjs": "fixture test",
    ".github/scripts/issue.test.cjs": "fixture test",
    "node_modules/oxlint/package.json": JSON.stringify({ bin: { oxlint: "bin/oxlint" } }),
    "node_modules/oxfmt/package.json": JSON.stringify({ bin: { oxfmt: "bin/oxfmt" } }),
  })) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), content);
  }
  const decision = classifyChanges(["scripts/release/candidate.mjs"]);
  const plan = localPlan({ root, decision, limit: 1 });
  assert.equal(plan.selectedTests.length, 1);
  assert(plan.deferred.some((message) => message.includes("exceed --max-tests=1")));
  assert(plan.deferred.some((message) => message.includes("installed/live")));
  assert(!plan.steps.some((step) => step.args.includes("install") || step.args.includes("build")));
  assert.deepEqual(scriptTestFiles(root), [
    ".github/scripts/issue.test.cjs",
    "scripts/release/candidate.failure.test.mjs",
    "scripts/release/candidate.test.mjs",
  ]);
  assert.equal(localPlan({ root, decision, scripts: true }).steps.length, 1);
  assert.equal(localOptions([]).run, undefined);
  assert.throws(() => localOptions(["--timeout-ms", "0"]));
  assert.throws(() => localOptions(["--max-tests", "1000"]));
});

test("argument mistakes are rejected instead of silently narrowing coverage", () => {
  assert.throws(() => optionsFromArguments(["--base"]));
  assert.throws(() => optionsFromArguments(["--unknown"]));
  assert.deepEqual(optionsFromArguments(["--base", "HEAD", "--ci", "--json"]), {
    base: "HEAD",
    ci: true,
    json: true,
  });
});
