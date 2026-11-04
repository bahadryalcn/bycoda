import test from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  nativeDevConfig,
  nativeDevHostDataPath,
  reuseNativeDevProfile,
  supervisedChild,
  completed,
  completedCargoBuild,
  stopChildren,
  waitForNativePage,
  frozenSourceIdentity,
} from "./dev-native.mjs";
import { WorkspaceBootstrapService } from "../../host/workspace-bootstrap.ts";
import { fingerprintFiles } from "./build-info.mjs";

test("a normally closed failing build releases its cache for a retry", async () => {
  const root = await mkdtemp(join(tmpdir(), "bycoda-build-failure-"));
  const children = new Set();
  try {
    const service = new WorkspaceBootstrapService({ resolveWorkspace: async () => root });
    await assert.rejects(
      service.withBuildCache("workspace", new AbortController().signal, async () => {
        const child = supervisedChild(process.execPath, ["-e", "process.exitCode=3"], {
          cwd: root,
          env: process.env,
          children,
        });
        return completedCargoBuild(child);
      }),
      /Build command failed \(3\)/,
    );
    assert.equal(
      await service.withBuildCache("workspace", new AbortController().signal, async () => "retry"),
      "retry",
    );
  } finally {
    await stopChildren(children);
    await rm(root, { recursive: true, force: true });
  }
});
test("a guardian transport close without retirement proof keeps the build cache held", async () => {
  const root = await mkdtemp(join(tmpdir(), "bycoda-build-unknown-"));
  try {
    const service = new WorkspaceBootstrapService({ resolveWorkspace: async () => root });
    await assert.rejects(
      service.withBuildCache("workspace", new AbortController().signal, async () => {
        const child = {
          closed: Promise.resolve(),
          spawnError: null,
          exitCode: 0,
          signalCode: null,
          failure: "",
          retirementVerified: false,
          retirement: Promise.reject(new Error("unknown guardian retirement")),
        };
        return completedCargoBuild(child);
      }),
      /unknown guardian retirement/,
    );
    await assert.rejects(
      service.withBuildCache("workspace", new AbortController().signal, async () => {}),
      /previous build completion is unknown/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test(
  "a dead build owner recovers only after the actual guardian retires its owned tree",
  { skip: process.platform !== "win32" || !process.env.BYCODA_TEST_GUARDIAN },
  async () => {
    const root = await mkdtemp(join(tmpdir(), "bycoda-build-guardian-crash-"));
    const script = join(root, "parent.mjs");
    const bootstrapUrl = pathToFileURL(join(process.cwd(), "host/workspace-bootstrap.ts")).href;
    const guardianUrl = pathToFileURL(join(process.cwd(), "host/provider-guardian.ts")).href;
    const worker =
      "const c=require('child_process').spawn(process.execPath,['-e',\"console.log('grand-ready');setInterval(()=>{},1000)\"],{stdio:['ignore','pipe','ignore']}); c.stdout.on('data',()=>console.log('TREE_READY:'+c.pid));setInterval(()=>{},1000)";
    await writeFile(
      script,
      `import { WorkspaceBootstrapService } from ${JSON.stringify(bootstrapUrl)};\nimport { NativeGuardianChild } from ${JSON.stringify(guardianUrl)};\nconst s=new WorkspaceBootstrapService({resolveWorkspace:async()=>process.argv[2]});\nawait s.withBuildCache('workspace',new AbortController().signal,async ({buildReceipt})=>{const c=new NativeGuardianChild(process.argv[3],{command:process.execPath,args:['-e',${JSON.stringify(worker)}],cwd:process.argv[2],env:process.env,buildReceipt});let output='';c.stdout.on('data',b=>{output+=b;const m=/TREE_READY:(\\d+)/.exec(output);if(m)console.log('OWNER_READY:'+m[1])});c.stderr.resume();await c.started;await c.retirement;});`,
    );
    const parent = spawn(process.execPath, [script, root, process.env.BYCODA_TEST_GUARDIAN], {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const sibling = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], {
      windowsHide: true,
      stdio: "ignore",
    });
    try {
      const descendantPid = await new Promise((resolve, reject) => {
        let text = "";
        const timer = setTimeout(
          () => reject(new Error("fixture owner readiness timed out")),
          15_000,
        );
        parent.stdout.on("data", (chunk) => {
          text += chunk;
          const match = /OWNER_READY:(\d+)/.exec(text);
          if (match) {
            clearTimeout(timer);
            resolve(Number(match[1]));
          }
        });
        parent.once("error", (error) => {
          clearTimeout(timer);
          reject(error);
        });
        parent.once("exit", () => {
          clearTimeout(timer);
          reject(new Error("fixture owner exited before ready"));
        });
      });
      const exited = new Promise((resolve) => parent.once("exit", resolve));
      parent.kill();
      await exited;
      const service = new WorkspaceBootstrapService({
        resolveWorkspace: async () => root,
        buildLeasePollMs: 20,
      });
      const until = performance.now() + 15_000;
      for (;;) {
        try {
          assert.equal(
            await service.withBuildCache(
              "workspace",
              new AbortController().signal,
              async () => "recovered",
            ),
            "recovered",
          );
          break;
        } catch (error) {
          if (
            !String(error).includes("previous build completion is unknown") ||
            performance.now() >= until
          )
            throw error;
          await new Promise((resolve) => setTimeout(resolve, 30));
        }
      }
      assert.throws(() => process.kill(descendantPid, 0), { code: "ESRCH" });
      assert.equal(sibling.exitCode, null);
      assert.equal(sibling.signalCode, null);
    } finally {
      for (const child of [parent, sibling]) {
        if (child.exitCode === null && child.signalCode === null) {
          const done = new Promise((resolve) => child.once("exit", resolve));
          child.kill();
          await done;
        }
      }
      await rm(root, { recursive: true, force: true });
    }
  },
);
import { loopbackUrl, screenshotOptions, verifyNativeIdentity } from "./dev-shot.mjs";

test("frozen native builds verify original source bytes and reject tampering or path escape without Git", async () => {
  const root = await mkdtemp(join(tmpdir(), "bycoda-frozen-"));
  try {
    await mkdir(join(root, "src"));
    const bytes = Buffer.from("export const original = true;\n");
    await writeFile(join(root, "src/main.ts"), bytes);
    const identity = {
      ...nativeIdentity,
      sourceFingerprint: fingerprintFiles(new Map([["src/main.ts", bytes]])),
    };
    const manifest = {
      schemaVersion: 1,
      identity,
      files: [{ path: "src/main.ts", sha256: createHash("sha256").update(bytes).digest("hex") }],
    };
    const save = () => writeFile(join(root, "frozen-source.json"), JSON.stringify(manifest));
    await save();
    assert.equal((await frozenSourceIdentity(root)).head, identity.head);
    await writeFile(join(root, "src/main.ts"), "changed");
    await assert.rejects(frozenSourceIdentity(root), /Frozen source changed/);
    manifest.files[0].path = "../outside.ts";
    await save();
    await assert.rejects(frozenSourceIdentity(root), /Invalid frozen source path/);
    manifest.files[0].path = "src/main.ts";
    manifest.files.push({ ...manifest.files[0] });
    await writeFile(join(root, "src/main.ts"), bytes);
    await save();
    await assert.rejects(frozenSourceIdentity(root), /Invalid frozen source path/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

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

test("profile continuation refuses live processes and retains data only after their owned child exits", async () => {
  const children = new Set();
  const child = supervisedChild(process.execPath, ["-e", "setInterval(()=>{}, 1000)"], {
    cwd: process.cwd(),
    env: process.env,
    children,
  });
  await new Promise((done, fail) => {
    child.once("spawn", done);
    child.once("error", fail);
  });
  const previous = {
    pid: child.pid,
    hostPid: child.pid,
    instanceId: "old-profile",
    desktopDataPath: "old-desktop",
    hostDataPath: "old-host",
  };
  const fresh = {
    instanceId: "new-profile",
    desktopDataPath: "new-desktop",
    hostDataPath: "new-host",
    executableRunDir: "new-immutable-binary",
    runId: "new-run",
    ports: { cdp: 19003 },
  };
  try {
    assert.throws(() => reuseNativeDevProfile(fresh, previous), /Stop the previous/);
    await stopChildren(children);
    const continued = reuseNativeDevProfile(fresh, previous);
    assert.equal(continued.desktopDataPath, previous.desktopDataPath);
    assert.equal(continued.hostDataPath, previous.hostDataPath);
    assert.equal(continued.instanceId, previous.instanceId);
    assert.equal(continued.executableRunDir, fresh.executableRunDir);
    assert.deepEqual(continued.ports, fresh.ports);
    assert.equal(continued.runId, fresh.runId);
  } finally {
    await stopChildren(children);
  }
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
    // oxlint-disable-next-line no-control-regex -- ANSI escapes must be stripped
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

test("native admission skips same-origin utility windows even with matching build identity", async () => {
  const utility = {
    url: () => "http://127.0.0.1:19001/desktop-control.html",
    evaluate: async () => assert.fail("A utility window cannot certify main readiness"),
  };
  const main = { url: () => "http://127.0.0.1:19001/", evaluate: async () => nativeIdentity };
  assert.equal(
    await waitForNativePage(
      { contexts: () => [{ pages: () => [utility, main] }] },
      "http://127.0.0.1:19001",
      nativeIdentity,
    ),
    main,
  );
});

test("one unresponsive main candidate cannot consume the whole discovery deadline", async () => {
  const pending = { url: () => "http://127.0.0.1:19001/", evaluate: () => new Promise(() => {}) };
  const main = {
    url: () => "http://127.0.0.1:19001/index.html",
    evaluate: async () => nativeIdentity,
  };
  assert.equal(
    await waitForNativePage(
      { contexts: () => [{ pages: () => [pending, main] }] },
      "http://127.0.0.1:19001",
      nativeIdentity,
      { timeoutMs: 500, candidateTimeoutMs: 10, pollMs: 1 },
    ),
    main,
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
