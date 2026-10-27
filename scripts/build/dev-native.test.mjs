import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  nativeDevConfig,
  nativeDevHostDataPath,
  supervisedChild,
  completed,
  stopChildren,
  waitForNativePage,
} from "./dev-native.mjs";
import { loopbackUrl, screenshotOptions, verifyNativeIdentity } from "./dev-shot.mjs";

test("Windows Host data follows only the isolated native profile instead of the checkout volume", () => {
  const environment = {
    desktopDataPath: join(tmpdir(), "isolated-desktop-profile"),
    hostDataPath: join(tmpdir(), "checkout-host"),
  };
  assert.equal(
    nativeDevHostDataPath(environment, "win32"),
    join(environment.desktopDataPath, "host"),
  );
  assert.equal(nativeDevHostDataPath(environment, "linux"), environment.hostDataPath);
});

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

test("failed build reports its bounded diagnostic tail and redacts common credential fields", async () => {
  const children = new Set();
  const child = supervisedChild(
    process.execPath,
    [
      "-e",
      "console.error('x'.repeat(9000)); console.error('\\u001b[31merror: native build failed\\u001b[0m\\nAuthorization: Bearer private-token\\napi_key=private-key'); process.exitCode=3;",
    ],
    {
      cwd: process.cwd(),
      env: process.env,
      children,
    },
  );
  await assert.rejects(completed(child), (error) => {
    assert.match(error.message, /Build command failed \(3\)/);
    assert.match(error.message, /error: native build failed/);
    assert.match(error.message, /Bearer \[redacted\]/);
    assert.match(error.message, /api_key=\[redacted\]/);
    assert.doesNotMatch(error.message, /private-token|private-key|\x1b/);
    assert(error.message.length < 4100);
    return true;
  });
  assert.equal(children.size, 0);
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

const nativeIdentity = {
  schemaVersion: 1,
  buildId: "dev-discovery",
  version: "1",
  channel: "dev",
  mode: "debug",
  repositoryId: "repo",
  branch: "branch",
  head: "head",
  sourceFingerprint: "fingerprint",
  capturedAt: 1,
  components: { web: "dev-discovery", native: "dev-discovery", host: "dev-discovery" },
  dirtyPaths: [],
  includedSources: [],
};

test("native CDP admission waits for target discovery and native IPC identity", async () => {
  let discovered = false;
  let reads = 0;
  const expectedPage = {
    url: () => "http://127.0.0.1:19001/",
    evaluate: async () => (++reads === 1 ? null : nativeIdentity),
  };
  const unrelatedPage = {
    url: () => "http://127.0.0.1:19002/",
    evaluate: async () => assert.fail("Another app origin must not be evaluated"),
  };
  const browser = {
    contexts: () => [{ pages: () => [unrelatedPage, ...(discovered ? [expectedPage] : [])] }],
  };
  queueMicrotask(() => (discovered = true));
  assert.equal(
    await waitForNativePage(browser, "http://127.0.0.1:19001", nativeIdentity, {
      timeoutMs: 500,
      pollMs: 1,
    }),
    expectedPage,
  );
  assert.equal(reads, 2);
});

test("native CDP admission rejects a concrete stale stamp without accepting its page", async () => {
  const page = {
    url: () => "http://127.0.0.1:19001/",
    evaluate: async () => ({ ...nativeIdentity, buildId: "stale" }),
  };
  await assert.rejects(
    waitForNativePage(
      { contexts: () => [{ pages: () => [page] }] },
      "http://127.0.0.1:19001",
      nativeIdentity,
    ),
    { code: "EADDRINUSE" },
  );
});

test("native CDP discovery and an unresponsive IPC both have bounded unavailable outcomes", async () => {
  await assert.rejects(
    waitForNativePage({ contexts: () => [] }, "http://127.0.0.1:19001", nativeIdentity, {
      timeoutMs: 20,
      pollMs: 1,
    }),
    { code: "NATIVE_CDP_NOT_READY" },
  );
  const page = {
    url: () => "http://127.0.0.1:19001/",
    evaluate: () => new Promise(() => {}),
  };
  await assert.rejects(
    waitForNativePage(
      { contexts: () => [{ pages: () => [page] }] },
      "http://127.0.0.1:19001",
      nativeIdentity,
      { timeoutMs: 20, pollMs: 1 },
    ),
    { code: "NATIVE_IDENTITY_UNAVAILABLE" },
  );
  const controller = new AbortController();
  controller.abort(new Error("Cancelled native launch"));
  await assert.rejects(
    waitForNativePage({ contexts: () => [] }, "http://127.0.0.1:19001", nativeIdentity, {
      signal: controller.signal,
    }),
    /Cancelled native launch/,
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
