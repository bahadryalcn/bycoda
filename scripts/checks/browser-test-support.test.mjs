import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import {
  validateManifest,
  selectSuites,
  compareSelections,
  listedCases,
  artifactPath,
} from "./browser-test-support.mjs";
import { serveBuiltWeb, verifyEmbeddedBuildIdentity } from "./browser-built-boot.mjs";
import { ignoredRustTests } from "./test-inventory.mjs";
import { reservePort, main as browserMain } from "./browser-tests.mjs";

test("frozen web proof requires the complete expected embedded stamp, not equal versions or an old build", () => {
  const stamp = {
    schemaVersion: 1,
    buildId: "frozen-build",
    version: "0.6.94",
    channel: "local",
    mode: "local",
    repositoryId: "repo",
    branch: "main",
    head: "a".repeat(40),
    sourceFingerprint: "b".repeat(64),
    capturedAt: 123,
    dirtyPaths: [{ path: "src/app.ts", status: "M" }],
    components: { web: "frozen-build", native: "frozen-build", host: "frozen-build" },
    includedSources: [],
  };
  assert.equal(
    verifyEmbeddedBuildIdentity(stamp, structuredClone(stamp)).sourceFingerprint,
    stamp.sourceFingerprint,
  );
  for (const mutation of [
    { sourceFingerprint: "c".repeat(64) },
    { buildId: "old-build" },
    { head: "d".repeat(40) },
    { components: { ...stamp.components, web: "old-build" } },
    { dirtyPaths: [] },
    { schemaVersion: 2 },
  ])
    assert.throws(
      () => verifyEmbeddedBuildIdentity(stamp, { ...stamp, ...mutation }),
      /frozen build identity/,
    );
  assert.throws(
    () => verifyEmbeddedBuildIdentity(stamp, { version: stamp.version }),
    /frozen build identity/,
  );
});

const suite = (id, files, extra = {}) => ({
  id,
  files,
  projects: [{ name: "chromium", browser: "chromium", files }],
  ...extra,
});

test("coverage rejects both missing ownership and two default fixtures for the same test", () => {
  const source = {
    suites: [suite("one", ["a.spec.ts"]), suite("two", ["a.spec.ts"])],
    aliases: {},
  };
  const result = validateManifest(source, ["a.spec.ts", "b.e2e.ts"]);
  assert(result.errors.some((error) => error.includes("found 2")));
  assert(result.errors.some((error) => error.includes("found 0")));
});

test("explicit fixture variants preserve alternate coverage without becoming default duplicates", () => {
  const source = {
    suites: [
      suite("one", ["a.e2e.ts"]),
      suite("alternate", ["a.e2e.ts"], { variantOf: "one", reason: "Different fixture protocol" }),
    ],
    aliases: { smoke: ["one"] },
  };
  assert.deepEqual(validateManifest(source, ["a.e2e.ts"]).errors, []);
  assert.deepEqual(
    selectSuites(["all", "smoke"], source).map((entry) => entry.id),
    ["one"],
  );
  assert.deepEqual(
    selectSuites(["alternate"], source).map((entry) => entry.id),
    ["alternate"],
  );
  assert.throws(() => selectSuites(["unknown"], source), /Unknown browser suite/);
  assert.throws(() => selectSuites([",,"], source), /at least one/);
  delete source.suites[1].reason;
  assert(validateManifest(source, ["a.e2e.ts"]).errors.some((error) => error.includes("reason")));
});

test("forwarded flags cannot turn a fixture receipt into a list or unrelated config result", async () => {
  await assert.rejects(browserMain(["--suite", "smoke", "--", "--list"]), /cannot replace/);
  await assert.rejects(
    browserMain(["--suite", "smoke", "--", "--config=other.ts"]),
    /cannot replace/,
  );
});

test("list parity catches a grep dropping tests even when every file still appears", () => {
  const before = [
    { file: "git.spec.ts", line: 1, title: "filters", project: "chromium" },
    { file: "git.spec.ts", line: 9, title: "conflict", project: "chromium" },
  ];
  const result = compareSelections(before, before.slice(1));
  assert.equal(result.missing.length, 1);
  assert.equal(result.added.length, 0);
  assert.equal(compareSelections(before, [...before, before[0]]).after, 2);
});

test("nested Playwright list identities include browser project and suite title", () => {
  const entries = listedCases({
    suites: [
      {
        title: "file.spec.ts",
        suites: [
          {
            title: "keyboard",
            specs: [
              {
                file: "G:\\work\\file.spec.ts",
                line: 10,
                title: "Enter",
                tests: [{ projectName: "webkit" }],
              },
            ],
          },
        ],
      },
    ],
  });
  assert.deepEqual(entries, [
    { file: "file.spec.ts", line: 10, title: "keyboard > Enter", project: "webkit" },
  ]);
  assert.throws(() => artifactPath("../outside"), /inside this checkout/);
});

test("fixture port allocation releases its own listener without selecting an installed service", async () => {
  const port = await reservePort();
  assert(port > 0);
  assert.equal(await reservePort(port), port);
});

test("built-web smoke serves built files, rejects traversal, and does not fake missing JS", async () => {
  const directory = mkdtempSync(join(realpathSync(tmpdir()), "bycoda-browser-harness-"));
  const dist = join(directory, "dist");
  mkdirSync(dist);
  writeFileSync(join(dist, "index.html"), "<main>built</main>");
  writeFileSync(join(dist, "client.js"), "export const built = true;");
  writeFileSync(join(directory, "outside.txt"), "not served");
  const server = await serveBuiltWeb(dist);
  try {
    const asset = await fetch(`${server.origin}/client.js`);
    assert.match(asset.headers.get("content-type"), /javascript/);
    assert.equal(await asset.text(), "export const built = true;");
    assert.equal(await (await fetch(`${server.origin}/threads/1`)).text(), "<main>built</main>");
    assert.equal((await fetch(`${server.origin}/missing.js`)).status, 404);
    assert.equal((await fetch(`${server.origin}/%2e%2e%2foutside.txt`)).status, 403);
  } finally {
    await server.close();
    assert.equal(dirname(directory), realpathSync(tmpdir()));
    rmSync(directory, { recursive: true });
  }
});

test("ignored native fixtures and parent-only crash helpers remain distinct inventory items", () => {
  const directory = mkdtempSync(join(realpathSync(tmpdir()), "bycoda-browser-harness-"));
  try {
    writeFileSync(
      join(directory, "sample.rs"),
      '#[test]\n#[ignore = "requires disposable sshd and built headless helper"]\nfn ssh_acceptance() {}\n#[test]\n#[ignore = "helper invoked only by parent crash test"]\nfn child_exit() {}\n',
    );
    const entries = ignoredRustTests(directory);
    assert.deepEqual(
      entries.map((entry) => entry.category),
      ["native-fixture", "parent-invoked-helper"],
    );
    assert(entries.every((entry) => entry.execution === "not-run"));
  } finally {
    assert.equal(dirname(directory), realpathSync(tmpdir()));
    rmSync(directory, { recursive: true });
  }
});
