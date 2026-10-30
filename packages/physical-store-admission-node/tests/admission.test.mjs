import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, linkSync } from "node:fs";
import filesystem from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { createInterface } from "node:readline";
import { once } from "node:events";
import { setImmediate as turn } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { loadPhysicalStoreAdmission } from "../index.mjs";

const artifact = process.env.BYCODA_PHYSICAL_ADMISSION_ADDON;
const probe = process.env.BYCODA_PHYSICAL_ADMISSION_PROBE;
assert.ok(
  artifact && path.isAbsolute(artifact),
  "Supply explicit BYCODA_PHYSICAL_ADMISSION_ADDON",
);
assert.ok(
  probe && path.isAbsolute(probe),
  "Supply explicit BYCODA_PHYSICAL_ADMISSION_PROBE",
);
assert.equal(
  typeof globalThis.gc,
  "function",
  "Run actual Node with --expose-gc",
);
const native = loadPhysicalStoreAdmission(artifact);
const evidence = path.resolve(
  "temp/verification/2026-10-30-host-notes-writer/node-port",
);
mkdirSync(evidence, { recursive: true });
const root = mkdtempSync(path.join(evidence, "actual-"));
function fixture(name) {
  const folder = path.join(root, name);
  mkdirSync(folder);
  const registry = path.join(folder, "registry"),
    file = path.join(folder, "physical.db");
  writeFileSync(file, "fresh physical file", { mode: 0o600 });
  const owner = native.openRegistry(registry);
  return { folder, registry, file, owner, store: owner.bindFile(file) };
}
function kernel(f, operation) {
  const result = spawnSync(probe, [operation, f.registry, f.file], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 5000,
  });
  assert.ifError(result.error);
  return { status: result.status, output: result.stdout.trim() };
}

test("explicit artifact loader never searches profiles or accepts guessed paths", () => {
  assert.throws(() => loadPhysicalStoreAdmission());
  assert.throws(() => loadPhysicalStoreAdmission("relative.node"));
  assert.throws(() => loadPhysicalStoreAdmission(path.resolve("bad.dll")));
  assert.equal(native.mechanicalAbiVersion(), 2);
});

test("a resolved JavaScript target is rejected before its code executes", () => {
  // Windows file symlink creation may require unavailable privileges. Isolate
  // only the resolver boundary; the target is real executable CommonJS code.
  const folder = path.join(root, "canonical-loader");
  mkdirSync(folder);
  const target = path.join(folder, "fixture.cjs");
  const alias = path.join(folder, "fixture.node");
  writeFileSync(
    target,
    "globalThis.__bycodaCanonicalTestExecuted=true;module.exports={mechanicalAbiVersion:()=>1,openRegistry:()=>({})};\n",
  );
  const original = filesystem.realpathSync;
  filesystem.realpathSync = (input, ...rest) =>
    input === alias ? target : original(input, ...rest);
  syncBuiltinESMExports();
  try {
    assert.throws(
      () => loadPhysicalStoreAdmission(alias),
      /resolved.*\.node extension/,
    );
    assert.equal(globalThis.__bycodaCanonicalTestExecuted, undefined);
  } finally {
    filesystem.realpathSync = original;
    syncBuiltinESMExports();
    delete globalThis.__bycodaCanonicalTestExecuted;
  }
});

test("real kernel writer drain/closed fence and exact explicit release", () => {
  const f = fixture("drain"),
    writer = f.store.tryWriter();
  assert.ok(writer);
  assert.equal(kernel(f, "closed").status, 12);
  const closing = f.store.tryBeginClose();
  assert.ok(closing);
  assert.equal(f.store.tryWriter(), null);
  assert.equal(kernel(f, "writer").status, 11);
  assert.equal(f.store.tryUpgrade(closing), null);
  f.store.releaseWriter(writer);
  const closed = f.store.tryUpgrade(closing);
  assert.ok(closed);
  assert.equal(f.store.tryWriter(), null);
  assert.equal(kernel(f, "writer").status, 11);
  assert.throws(() => f.store.releaseClosing(closing));
  f.store.releaseClosed(closed);
  assert.equal(kernel(f, "writer").status, 0);
  assert.throws(() => f.store.releaseClosed(closed));
});

test("opaque handles refuse forged values/wrong owner/binding/type and double release", () => {
  const f = fixture("opaque"),
    sameOwnerOther = f.owner.bindFile(f.file),
    otherOwner = native.openRegistry(f.registry).bindFile(f.file),
    writer = f.store.tryWriter();
  assert.ok(writer);
  assert.throws(() => f.store.releaseWriter({ slot: 1 }));
  assert.throws(() => sameOwnerOther.releaseWriter(writer));
  assert.throws(() => otherOwner.releaseWriter(writer));
  assert.throws(() => f.store.releaseClosing(writer));
  assert.equal(kernel(f, "closed").status, 12);
  f.store.releaseWriter(writer);
  assert.throws(() => f.store.releaseWriter(writer));
  const closing = f.store.tryBeginClose();
  assert.ok(closing);
  assert.throws(() => otherOwner.tryUpgrade(closing));
  assert.equal(kernel(f, "writer").status, 11);
  const closed = f.store.tryUpgrade(closing);
  assert.ok(closed);
  f.store.releaseClosed(closed);
  assert.equal(kernel(f, "closed").status, 0);
});

test("hardlink aliases use the same actual OS identity and contention domain", () => {
  const f = fixture("alias"),
    alias = path.join(f.folder, "alias.db");
  linkSync(f.file, alias);
  const other = f.owner.bindFile(alias);
  assert.equal(other.identity().nativeFormat, f.store.identity().nativeFormat);
  assert.equal(f.store.identity().links, 2n);
  const closing = f.store.tryBeginClose();
  assert.ok(closing);
  assert.equal(other.tryWriter(), null);
  f.store.releaseClosing(closing);
  const writer = other.tryWriter();
  assert.ok(writer);
  other.releaseWriter(writer);
});

test("actual JS GC collects token wrapper but cannot release live native writer", async () => {
  const f = fixture("gc");
  let writer = f.store.tryWriter();
  assert.ok(writer);
  const weak = new WeakRef(writer);
  writer = undefined;
  let collected = false;
  for (let attempt = 0; attempt < 80; attempt++) {
    await turn();
    globalThis.gc();
    if (!weak.deref()) {
      collected = true;
      break;
    }
  }
  assert.equal(collected, true, "JS native token wrapper was not collected");
  assert.equal(f.owner.statistics().ownerActive, 1);
  assert.equal(kernel(f, "closed").status, 12);
  const closing = f.store.tryBeginClose();
  assert.ok(closing);
  assert.equal(f.store.tryUpgrade(closing), null);
  f.store.releaseClosing(closing);
  assert.equal(kernel(f, "closed").status, 12);
});

test("GC of a closing token retains closed ingress instead of silently reopening", async () => {
  const f = fixture("gc-closing");
  let closing = f.store.tryBeginClose();
  assert.ok(closing);
  const weak = new WeakRef(closing);
  closing = undefined;
  let collected = false;
  for (let attempt = 0; attempt < 80; attempt++) {
    await turn();
    globalThis.gc();
    if (!weak.deref()) {
      collected = true;
      break;
    }
  }
  assert.equal(collected, true);
  assert.equal(f.store.tryWriter(), null);
  assert.equal(kernel(f, "writer").status, 11);
});

test("first addon Worker environment EXIT retains the original process registry/accounting", () => {
  const f = fixture("environment");
  const result = spawnSync(
    process.execPath,
    [
      fileURLToPath(
        new URL("./support/environment-first.mjs", import.meta.url),
      ),
      artifact,
      f.registry,
      f.file,
    ],
    { encoding: "utf8", windowsHide: true, timeout: 10000 },
  );
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout.trim()).originalRegistrySurvived, true);
  assert.equal(kernel(f, "closed").status, 0);
});

test("actual child process death releases its kernel writer, not a JS finalizer", async () => {
  const f = fixture("process");
  const child = spawn(
    process.execPath,
    [
      fileURLToPath(new URL("./support/process.mjs", import.meta.url)),
      artifact,
      f.registry,
      f.file,
    ],
    { stdio: ["pipe", "pipe", "pipe"], windowsHide: true },
  );
  const lines = createInterface({ input: child.stdout });
  const exit = once(child, "exit");
  try {
    const [line] = await once(lines, "line", {
      signal: AbortSignal.timeout(5000),
    });
    assert.equal(JSON.parse(line).acquired, true);
    assert.equal(kernel(f, "closed").status, 12);
    child.stdin.end("exit\n");
    const [code] = await exit;
    assert.equal(code, 0);
    assert.equal(kernel(f, "closed").status, 0);
  } finally {
    lines.close();
    if (child.exitCode === null) {
      child.stdin.end("exit\n");
      await exit;
    }
  }
});

test("bounded native capacity rejects new reservations without evicting originals", () => {
  const f = fixture("owner-capacity"),
    handles = [];
  for (let index = 0; index < f.owner.statistics().maxOwner; index++) {
    const handle = f.store.tryWriter();
    assert.ok(handle);
    handles.push(handle);
  }
  assert.throws(() => f.store.tryWriter(), /capacity/);
  assert.equal(kernel(f, "closed").status, 12);
  assert.equal(f.owner.statistics().ownerActive, 64);
  for (const handle of handles) f.store.releaseWriter(handle);
  assert.equal(f.owner.statistics().ownerActive, 0);
  assert.equal(kernel(f, "closed").status, 0);
});

test("process cap is shared across owners and retains all existing kernel locks", () => {
  const f = fixture("process-capacity"),
    held = [];
  let owner = f.owner,
    store = f.store;
  while (owner.statistics().processActive < owner.statistics().maxProcess) {
    if (owner.statistics().ownerActive === owner.statistics().maxOwner) {
      owner = native.openRegistry(f.registry);
      store = owner.bindFile(f.file);
    }
    const writer = store.tryWriter();
    assert.ok(writer);
    held.push({ store, writer });
  }
  assert.throws(() => store.tryWriter(), /capacity/);
  assert.equal(kernel(f, "closed").status, 12);
  for (const { store, writer } of held) store.releaseWriter(writer);
  assert.equal(kernel(f, "closed").status, 0);
});
