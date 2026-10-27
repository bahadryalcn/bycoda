import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  acceptanceOptions,
  acceptanceProjectName,
  assertWithin,
  validateAcceptanceRun,
} from "./acceptance-native.mjs";
import { nativeDevDesktopDataPath } from "../../host/workspace-bootstrap.ts";

test("rejects traversal and invalid scenario selectors before starting any native work", () => {
  for (const id of ["../owner", "..", "q1/other", "q1\\other"])
    assert.throws(() => acceptanceOptions(["--id", id]));
  for (const scenario of ["0", "9", "1,nope", ""])
    assert.throws(() => acceptanceOptions(["--scenario", scenario]));
  assert.deepEqual(acceptanceOptions(["--scenario", "3,5"]).scenarios, [3, 5]);
});

test("rejects lexical parent and sibling-prefix escapes", () => {
  const root = join(tmpdir(), "native-validation");
  for (const path of [root, join(root, "..", "owner"), `${root}-owner`])
    assert.throws(() => assertWithin(root, path));
  assert.equal(assertWithin(root, join(root, "child")), join(root, "child"));
});

test("gives independent acceptance IDs distinct visible project names in the same native run", () => {
  assert.notEqual(
    acceptanceProjectName("q1-case3", "q1-proof2"),
    acceptanceProjectName("q1-case5", "q1-proof2"),
  );
  const prefix = "very-long-acceptance-name-".repeat(3);
  assert.notEqual(
    acceptanceProjectName(`${prefix}a`, "run"),
    acceptanceProjectName(`${prefix}b`, "run"),
  );
  assert(acceptanceProjectName(`${prefix}a`, "run").length < 80);
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "bycoda-acceptance-validator-"));
  const directory = join(root, "temp", "build", "managed-runs", "workspace", "run");
  await mkdir(join(directory, "host"), { recursive: true });
  await mkdir(join(directory, "bin"));
  await writeFile(join(directory, "bin", "bycoda.exe"), "fake executable; never launched");
  const build = {
    schemaVersion: 1,
    buildId: "test",
    version: "0.0.0",
    channel: "dev",
    mode: "debug",
    repositoryId: "fake",
    branch: "test",
    head: "abc",
    sourceFingerprint: "abc",
    capturedAt: 1,
    dirtyPaths: [],
    components: { native: "test", web: "test", host: "test" },
    includedSources: [],
  };
  await writeFile(join(directory, "build-info.json"), JSON.stringify(build));
  const run = {
    instanceId: "acceptance-validator-test",
    desktopDataPath: nativeDevDesktopDataPath("acceptance-validator-test"),
    hostDataPath: join(directory, "host"),
    executableRunDir: join(directory, "bin"),
    executable: join(directory, "bin", "bycoda.exe"),
    buildManifest: join(directory, "build-info.json"),
    devUrl: "http://127.0.0.1:34567",
    ports: { ports: { vite: 34567, host: 34568, cdp: 34569, hmr: 34570 } },
  };
  const path = join(directory, "dev-run.json");
  return {
    root,
    directory,
    run,
    path,
    build,
    async save() {
      await writeFile(path, JSON.stringify(run));
    },
  };
}

test("accepts a complete isolated record without connecting or launching processes", async () => {
  const item = await fixture();
  try {
    await item.save();
    assert.equal((await validateAcceptanceRun(item.root, item.path)).identity.buildId, "test");
  } finally {
    await rm(item.root, { recursive: true, force: true });
  }
});

test("rejects installed desktop identity, owner Host paths, reserved ports and nondev stamps", async () => {
  const item = await fixture();
  try {
    const desktop = item.run.desktopDataPath;
    item.run.desktopDataPath = join(tmpdir(), "com.bycoda.desktop");
    await item.save();
    await assert.rejects(validateAcceptanceRun(item.root, item.path));
    item.run.desktopDataPath = desktop;
    const host = item.run.hostDataPath;
    item.run.hostDataPath = item.root;
    await item.save();
    await assert.rejects(validateAcceptanceRun(item.root, item.path));
    item.run.hostDataPath = host;
    item.run.ports.ports.hmr = 1421;
    await item.save();
    await assert.rejects(validateAcceptanceRun(item.root, item.path));
    item.run.ports.ports.hmr = 34570;
    await item.save();
    await writeFile(item.run.buildManifest, JSON.stringify({ ...item.build, channel: "stable" }));
    await assert.rejects(validateAcceptanceRun(item.root, item.path));
  } finally {
    await rm(item.root, { recursive: true, force: true });
  }
});
