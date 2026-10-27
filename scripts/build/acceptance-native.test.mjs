import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  acceptanceOptions,
  acceptanceProjectName,
  acceptanceStage,
  completedHostAcceptanceReply,
  hot1Scenarios,
  hot1Titles,
  v94Scenarios,
  v94Titles,
  assertWithin,
  assertRejectedNativeAdmission,
  validateAcceptanceRun,
} from "./acceptance-native.mjs";
import { nativeDevDesktopDataPath } from "../../host/workspace-bootstrap.ts";

test("requires the Host writer rejection and exact new reservation before legacy recovery seeding", () => {
  const expected = {
    sessionId: "session",
    workspaceId: "workspace",
    userBlockId: "new-user",
    runId: "new-run",
  };
  const writerError =
    "Host rejected request: Another workspace writer or unknown activity is still active";
  assert.doesNotThrow(() => assertRejectedNativeAdmission(writerError, expected, expected));
  assert.throws(() =>
    assertRejectedNativeAdmission(
      "Conversation changed before managed turn capture",
      expected,
      expected,
    ),
  );
  assert.throws(() =>
    assertRejectedNativeAdmission(
      writerError,
      { ...expected, userBlockId: "completed-user" },
      expected,
    ),
  );
  assert.throws(() =>
    assertRejectedNativeAdmission(writerError, { ...expected, runId: "completed-run" }, expected),
  );
  assert.throws(() => assertRejectedNativeAdmission(null, expected, expected));
  assert.throws(() => assertRejectedNativeAdmission(writerError, null, expected));
});

test("rejects traversal and invalid scenario selectors before starting any native work", () => {
  for (const id of ["../owner", "..", "q1/other", "q1\\other"])
    assert.throws(() => acceptanceOptions(["--id", id]));
  for (const scenario of ["0", "9", "1,nope", ""])
    assert.throws(() => acceptanceOptions(["--scenario", scenario]));
  assert.deepEqual(acceptanceOptions(["--scenario", "3,5"]).scenarios, [3, 5]);
});

test("HOT1 selects only the seven hotfix checks without native recovery or delivery", () => {
  const options = acceptanceOptions(["--suite", "hot1"]);
  assert.deepEqual(options.scenarios, [1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(Object.keys(hot1Scenarios), Object.keys(hot1Titles));
  assert.throws(() => acceptanceOptions(["--suite", "hot1", "--scenario", "8"]));
  assert.throws(() => acceptanceOptions(["--suite", "unknown"]));
  assert.equal(options.model, undefined, "Acceptance must use explicitly supplied account choices");
  assert.equal(options.switchModel, undefined);
});

test("V94 selects exactly the five integrated lightweight acceptance scenarios", () => {
  const options = acceptanceOptions([
    "--suite",
    "v94",
    "--model",
    "explicit-first",
    "--switch-model",
    "explicit-second",
  ]);
  assert.deepEqual(options.scenarios, [1, 2, 3, 4, 5]);
  assert.deepEqual(Object.keys(v94Scenarios), Object.keys(v94Titles));
  assert.equal(options.model, "explicit-first");
  assert.equal(options.switchModel, "explicit-second");
  assert.throws(() => acceptanceOptions(["--suite", "v94", "--scenario", "6"]));
  assert.deepEqual(acceptanceOptions(["--suite", "v94", "--scenario", "3,4"]).scenarios, [3, 4]);
});

test("contextual acceptance requires an idle successful Host reply rather than a saved request or partial reply", () => {
  const source = { status: "idle", session: { blocks: [{ role: "user", text: "Request" }] } };
  assert.equal(completedHostAcceptanceReply(source), false);
  source.session.blocks.push({ role: "assistant", text: "READY" });
  assert.equal(completedHostAcceptanceReply({ ...source, status: "running" }), false);
  assert.equal(completedHostAcceptanceReply(source), source);
  assert.throws(() => completedHostAcceptanceReply({ ...source, status: "interrupted" }));
  source.session.blocks.push({ role: "system", text: "Provider failed", notice: "error" });
  assert.throws(() => completedHostAcceptanceReply(source));
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

test("bounds an unanswered operation and records its exact native acceptance stage", async () => {
  const output = await mkdtemp(join(tmpdir(), "bycoda-acceptance-stage-"));
  try {
    const context = {
      output,
      currentScenario: 6,
      run: { runId: "fake-run" },
      state: { sessionId: "fake-session" },
    };
    await assert.rejects(
      acceptanceStage(context, "native IPC never responds", () => new Promise(() => {}), 30),
      (error) =>
        error.code === "NATIVE_ACCEPTANCE_STAGE_TIMEOUT" &&
        error.stage === "native IPC never responds",
    );
    const snapshot = JSON.parse(await readFile(join(output, "native-stage.json"), "utf8"));
    assert.equal(snapshot.event.status, "timed_out");
    assert.equal(snapshot.event.scenario, 6);
    assert.equal(snapshot.event.sessionId, "fake-session");
    assert.equal(snapshot.lastFailure.stage, "native IPC never responds");
    assert.equal(context.stageTimedOut, true);
  } finally {
    await rm(output, { recursive: true, force: true });
  }
});

test("records nested stage completion without retaining completed operations", async () => {
  const output = await mkdtemp(join(tmpdir(), "bycoda-acceptance-stage-"));
  try {
    const context = { output, state: {} };
    assert.equal(
      await acceptanceStage(context, "scenario", () =>
        acceptanceStage(context, "IPC", async () => 42),
      ),
      42,
    );
    const snapshot = JSON.parse(await readFile(join(output, "native-stage.json"), "utf8"));
    assert.equal(snapshot.event.stage, "scenario");
    assert.equal(snapshot.event.status, "passed");
    assert.deepEqual(snapshot.active, []);
    assert.equal(
      (await readFile(join(output, "native-stages.jsonl"), "utf8")).trim().split("\n").length,
      4,
    );
  } finally {
    await rm(output, { recursive: true, force: true });
  }
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

test(
  "accepts only the matching Windows dev profile Host directory outside the checkout",
  { skip: process.platform !== "win32" },
  async () => {
    const item = await fixture();
    const appData = process.env.APPDATA;
    try {
      process.env.APPDATA = item.root;
      item.run.desktopDataPath = nativeDevDesktopDataPath(item.run.instanceId);
      item.run.hostDataPath = join(item.run.desktopDataPath, "host");
      await mkdir(item.run.hostDataPath, { recursive: true });
      await item.save();
      assert.equal((await validateAcceptanceRun(item.root, item.path)).identity.buildId, "test");
      item.run.hostDataPath = join(nativeDevDesktopDataPath("another-dev-run"), "host");
      await mkdir(item.run.hostDataPath, { recursive: true });
      await item.save();
      await assert.rejects(validateAcceptanceRun(item.root, item.path));
    } finally {
      if (appData === undefined) delete process.env.APPDATA;
      else process.env.APPDATA = appData;
      await rm(item.root, { recursive: true, force: true });
    }
  },
);

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
