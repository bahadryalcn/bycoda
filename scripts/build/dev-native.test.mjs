import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { nativeDevConfig, supervisedChild, completed, stopChildren } from "./dev-native.mjs";
import { loopbackUrl, screenshotOptions, verifyNativeIdentity } from "./dev-shot.mjs";

test("leased native URLs and CSP agree while production CSP remains untouched", async () => {
  const original = JSON.parse(
    await readFile(new URL("../../src-tauri/tauri.conf.json", import.meta.url), "utf8"),
  );
  const config = nativeDevConfig(original, { BYCODA_VITE_PORT: "19001", BYCODA_HMR_PORT: "19002" });
  assert.equal(config.build.devUrl, "http://127.0.0.1:19001");
  assert.match(config.app.security.devCsp, /http:\/\/127\.0\.0\.1:19001/);
  assert.match(config.app.security.devCsp, /ws:\/\/localhost:19002/);
  assert.doesNotMatch(config.app.security.devCsp, /:142[01]\b/);
  assert.equal(config.app.security.csp, undefined);
  assert.match(original.app.security.devCsp, /:1420/);
});

test("fast child completion and owned child cancellation settle without losing close events", async () => {
  const children = new Set();
  const child = supervisedChild(process.execPath, ["-e", "console.log('ready')"], {
    cwd: process.cwd(),
    env: process.env,
    children,
  });
  await child.closed;
  assert.equal(await completed(child), "ready");
  const running = supervisedChild(process.execPath, ["-e", "setInterval(()=>{}, 1000)"], {
    cwd: process.cwd(),
    env: process.env,
    children,
  });
  await new Promise((done, reject) => {
    running.once("spawn", done);
    running.once("error", reject);
  });
  await stopChildren(children);
  assert.equal(children.size, 0);
  assert.ok(running.exitCode !== null || running.signalCode !== null);
});

test("native capture rejects stale records against the embedded running identity", async () => {
  const identity = {
    schemaVersion: 1,
    buildId: "dev-1",
    version: "1",
    channel: "dev",
    mode: "debug",
    repositoryId: "repo",
    branch: "branch",
    head: "head",
    sourceFingerprint: "fingerprint",
    capturedAt: 1,
    components: { web: "dev-1", native: "dev-1", host: "dev-1" },
    dirtyPaths: [],
    includedSources: [],
  };
  assert.deepEqual(
    await verifyNativeIdentity({ evaluate: async () => identity }, identity),
    identity,
  );
  await assert.rejects(
    verifyNativeIdentity({ evaluate: async () => ({ ...identity, buildId: "other" }) }, identity),
    /does not match/,
  );
  await assert.rejects(
    verifyNativeIdentity({ evaluate: async () => null }, identity),
    /does not match/,
  );
});

test("screenshot requests keep output within verification and require clear evidence source", () => {
  const options = screenshotOptions([
    "--id",
    "s6-review",
    "--url",
    "http://localhost:19001",
    "--width",
    "800",
    "--scheme",
    "light",
  ]);
  assert.equal(options.width, 800);
  assert.equal(options.scheme, "light");
  assert.throws(() => screenshotOptions(["--id", "../outside", "--url", "http://localhost:19001"]));
  assert.throws(() =>
    screenshotOptions(["--id", "review", "--url", "http://localhost", "--run", "run.json"]),
  );
  assert.throws(() =>
    screenshotOptions(["--id", "review", "--url", "http://localhost", "--width", "NaN"]),
  );
  assert.throws(() => loopbackUrl("https://example.com"));
  assert.throws(() => loopbackUrl("http://secret@localhost:19001"));
});
