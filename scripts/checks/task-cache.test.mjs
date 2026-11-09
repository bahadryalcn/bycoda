import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  cachePolicy,
  restoreOutput,
  saveOutput,
  taskInputs,
  taskInputKey,
  fingerprintTaskFiles,
} from "./task-cache.mjs";
const identity = {
  schemaVersion: 1,
  contractVersion: 1,
  task: "repository-inventory",
  platform: "win32",
  arch: "x64",
  nodeVersion: "24.0.0",
  typescriptVersion: "6.0.0",
  compilerHash: "c".repeat(64),
  inputFingerprint: "b".repeat(64),
  configurationHash: "d".repeat(64),
};
const input = { key: taskInputKey(identity), identity };
test("forks are disabled and only main or explicit local owners may write", () => {
  assert.deepEqual(
    cachePolicy({
      ci: true,
      event: "pull_request",
      repository: "owner/repo",
      headRepository: "fork/repo",
    }).read,
    false,
  );
  assert.equal(
    cachePolicy({
      ci: true,
      event: "pull_request",
      repository: "owner/repo",
      headRepository: "owner/repo",
    }).write,
    false,
  );
  assert.equal(
    cachePolicy({
      ci: true,
      event: "workflow_dispatch",
      ref: "refs/heads/main",
      repository: "owner/repo",
    }).write,
    true,
  );
  assert.equal(cachePolicy({ localOwner: false }).write, false);
});
test("real cache hits rehash bytes, report restore measurements and refuse poisoned or foreign output", (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "bycoda-task-cache-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const output = path.join(root, "output"),
    store = path.join(root, "store"),
    destination = path.join(root, "restored"),
    policy = cachePolicy({ localOwner: true });
  mkdirSync(output);
  writeFileSync(path.join(output, "repository-inventory.json"), '{"fixture":true}');
  assert.equal(restoreOutput({ store, destination, input, policy }).hit, false);
  saveOutput({ store, output, input, policy });
  const hit = restoreOutput({ store, destination, input, policy });
  assert.equal(hit.hit, true);
  assert.equal(hit.liveAcceptance, false);
  assert(hit.restoreMs >= 0 && hit.bytesVerified > 0);
  assert.equal(
    readFileSync(path.join(destination, "repository-inventory.json"), "utf8"),
    '{"fixture":true}',
  );
  assert.throws(() => saveOutput({ store, output, input, policy }));
  assert.throws(() =>
    restoreOutput({
      store,
      destination,
      input: { ...input, identity: { ...input.identity, arch: "arm64" } },
      policy,
    }),
  );
  writeFileSync(path.join(store, input.key, "repository-inventory.json"), "tampered");
  assert.throws(() => restoreOutput({ store, destination, input, policy }));
  assert.throws(() =>
    saveOutput({ store: path.join(root, "other"), output, input, policy: { write: false } }),
  );
});
test("unknown tasks and unavailable complete inputs cannot enable cache reuse", () => {
  assert.throws(() => taskInputs({ root: process.cwd(), task: "arbitrary-shell-command" }));
  assert.throws(() => taskInputs({ root: "/not-a-repository", task: "repository-inventory" }));
});
test("keys cover ignored resolver source, installed dependency bytes and workspace manifests", (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "bycoda-task-inputs-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const files = {
    "package.json": "fixture",
    "src/ignored-generated.ts": "export {}",
    "packages/core/package.json": '{"name":"core"}',
    "node_modules/fixture/index.d.ts": "fixture dependency",
  };
  for (const [file, bytes] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), bytes);
  }
  const before = fingerprintTaskFiles(root, ["package.json"]);
  assert.equal(before.inputFiles, 4);
  assert.deepEqual(fingerprintTaskFiles(root, ["package.json"]), before);
  for (const file of [
    "src/ignored-generated.ts",
    "packages/core/package.json",
    "node_modules/fixture/index.d.ts",
  ]) {
    writeFileSync(path.join(root, file), `${files[file]} changed`);
    assert.notEqual(
      fingerprintTaskFiles(root, ["package.json"]).inputFingerprint,
      before.inputFingerprint,
    );
    writeFileSync(path.join(root, file), files[file]);
  }
  assert.throws(() =>
    restoreOutput({
      store: root,
      destination: root,
      input: { ...input, key: "0".repeat(64) },
      policy: { read: true },
    }),
  );
});
