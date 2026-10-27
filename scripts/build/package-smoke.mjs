/** Consume immutable package bytes. No build, installation, provider call or service control. */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  realpathSync,
  copyFileSync,
  statSync,
  lstatSync,
} from "node:fs";
import { join, resolve, dirname, relative, isAbsolute, delimiter } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import {
  validatePackageManifest,
  stagePackage,
  digest,
  smokeChecks,
} from "../release/package-manifest.mjs";
import {
  validateLocalPackageManifest,
  stageLocalPackage,
} from "../release/local-package-manifest.mjs";
function artifactPath(value) {
  const path = resolve(value),
    local = relative(resolve("temp"), path);
  assert(
    existsSync(resolve(".artifact")) && local && !local.startsWith("..") && !isAbsolute(local),
    "Smoke outputs must belong to the current checkout's temp directory",
  );
  return path;
}
async function reservePort() {
  const server = createServer();
  await new Promise((done, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", done);
  });
  const port = server.address().port;
  await new Promise((done) => server.close(done));
  return port;
}

/** Old executables may ignore the flag and open their ordinary profile. Never launch them. */
export function assertNativeSmokeCapability(bytes) {
  for (const marker of [
    "BYCODA_PACKAGE_SMOKE_REQUEST",
    "bycoda-package-smoke-owned-v1",
    "native-webview-proof",
  ])
    assert(
      bytes.includes(Buffer.from(marker)),
      "This native artifact does not contain the guarded package-smoke protocol; rebuild it before launch",
    );
}

export function runtimeBase(environment = process.env, platform = process.platform) {
  if (platform !== "win32") return artifactPath("temp/build");
  assert(
    environment.LOCALAPPDATA && isAbsolute(environment.LOCALAPPDATA),
    "Windows smoke requires the actual user-local AppData path for Host ACL isolation",
  );
  let directory = realpathSync(environment.LOCALAPPDATA);
  for (const part of ["bycoda", "package-smoke-runs"]) {
    directory = join(directory, part);
    if (!existsSync(directory)) mkdirSync(directory);
    assert(
      lstatSync(directory).isDirectory() && !lstatSync(directory).isSymbolicLink(),
      "Windows smoke runtime parent must not be a link",
    );
  }
  return realpathSync(directory);
}

export function smokeEnvironment(environment, seed, hostNode, platform = process.platform) {
  const env = Object.fromEntries(
    Object.entries(environment).filter(
      ([name]) =>
        !/(TOKEN|SECRET|PASSWORD|API_KEY|^OPENAI|^ANTHROPIC|^CLAUDE|^CODEX|^BYCODA_|^TAURI_|^NODE_OPTIONS$|^SSH_|^GIT_|^AWS_|^AZURE_|^GOOGLE_|^GCLOUD_)/i.test(
          name,
        ),
    ),
  );
  const temporary = join(seed.home, "tmp"),
    roaming = join(seed.home, "AppData", "Roaming"),
    local = join(seed.home, "AppData", "Local");
  for (const directory of [temporary, roaming, local]) mkdirSync(directory, { recursive: true });
  Object.assign(env, {
    HOME: seed.home,
    USERPROFILE: seed.home,
    APPDATA: roaming,
    LOCALAPPDATA: local,
    XDG_CONFIG_HOME: join(seed.home, ".config"),
    XDG_DATA_HOME: join(seed.home, ".local", "share"),
    XDG_CACHE_HOME: join(seed.home, ".cache"),
    TMPDIR: temporary,
    TMP: temporary,
    TEMP: temporary,
    BYCODA_HOST_DIR: seed.host,
  });
  env.PATH =
    platform === "win32"
      ? [
          dirname(hostNode),
          join(env.SystemRoot ?? "C:\\Windows", "System32"),
          join(env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0"),
        ].join(";")
      : [dirname(hostNode), "/usr/bin", "/bin", "/usr/sbin", "/sbin"].join(delimiter);
  return env;
}

export function seedOldDatabases(root) {
  const project = join(root, "project"),
    home = join(root, "home"),
    host = join(home, ".bycoda-host"),
    seed = join(root, "seed");
  for (const path of [project, home, host, seed]) mkdirSync(path, { recursive: true });
  const sessionId = "package-smoke-saved-session",
    title = "Package smoke saved conversation",
    history = "Retained history from an isolated version-one database.";
  const blocks = [
    { id: "smoke-user", role: "user", text: "Keep this saved conversation available." },
    { id: "smoke-assistant", role: "assistant", text: history },
  ];
  const session = {
    id: sessionId,
    cwd: project,
    harness: "codex",
    model: "gpt-5.4",
    modelSettings: {},
    runtimeMode: "supervised",
    title,
    blocks,
  };
  const file = join(seed, "bycoda.db"),
    db = new DatabaseSync(file);
  try {
    db.exec(`CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,applied_at INTEGER NOT NULL);
      INSERT INTO schema_migrations VALUES(1,1);
      CREATE TABLE sessions(id TEXT PRIMARY KEY,cwd TEXT NOT NULL,harness TEXT NOT NULL,model TEXT NOT NULL,model_settings TEXT NOT NULL DEFAULT '{}',runtime_mode TEXT NOT NULL,title TEXT NOT NULL,provider_session_id TEXT,blocks_json TEXT NOT NULL DEFAULT '[]',created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
      CREATE TABLE workspace_snapshot(id INTEGER PRIMARY KEY CHECK(id=1),snapshot_json TEXT NOT NULL,updated_at INTEGER NOT NULL);`);
    db.prepare("INSERT INTO sessions VALUES(?,?,?,?,?,?,?,?,?,?,?)").run(
      sessionId,
      project,
      "codex",
      session.model,
      "{}",
      "supervised",
      title,
      null,
      JSON.stringify(blocks),
      1000,
      1000,
    );
    const snapshot = {
      tabs: [
        {
          kind: "session",
          id: "smoke-tab",
          layout: { type: "leaf", id: sessionId },
          focusedId: sessionId,
          editorPanes: [],
        },
      ],
      sessions: [{ ...session, blocks: undefined }],
      activeTabId: "smoke-tab",
      projectCwd: project,
      projectTerminals: [],
    };
    db.prepare("INSERT INTO workspace_snapshot VALUES(1,?,1000)").run(JSON.stringify(snapshot));
  } finally {
    db.close();
  }
  const hostDb = new DatabaseSync(join(host, "host.db"));
  try {
    hostDb.exec(
      "CREATE TABLE projects(id TEXT PRIMARY KEY,cwd TEXT NOT NULL UNIQUE,name TEXT NOT NULL); CREATE TABLE sessions(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id),snapshot TEXT NOT NULL);",
    );
    hostDb
      .prepare("INSERT INTO projects VALUES(?,?,?)")
      .run("smoke-project", project, "Package smoke project");
    hostDb.prepare("INSERT INTO sessions VALUES(?,?,?)").run(
      sessionId,
      "smoke-project",
      JSON.stringify({
        projectId: "smoke-project",
        revision: 1,
        status: "idle",
        updatedAt: 1000,
        session,
      }),
    );
  } finally {
    hostDb.close();
  }
  return {
    project,
    home,
    host,
    seedDb: file,
    seedSha256: digest(readFileSync(file)),
    sessionId,
    title,
    history,
  };
}

export function validateNativeProof(proof, request, manifest, pid) {
  assert(
    proof?.schemaVersion === 1 && proof.evidence === "native-webview-proof",
    "Missing real native WebView proof",
  );
  assert.equal(proof.nonce, request.nonce, "Foreign native proof nonce");
  assert.equal(proof.pid, pid, "Native proof belongs to another process");
  assert.equal(proof.sourceSha, manifest.source.sha, "Foreign native source");
  assert.equal(proof.artifactDigest, manifest.artifactDigest, "Foreign package artifact");
  assert.equal(
    proof.buildIdentity?.buildId,
    manifest.buildIdentity.buildId,
    "Foreign native build",
  );
  assert.equal(
    proof.buildIdentity?.sourceFingerprint,
    manifest.buildIdentity.sourceFingerprint,
    "Foreign native source bytes",
  );
  assert.equal(proof.buildIdentity?.head, manifest.source.sha, "Native source SHA mismatch");
  assert.equal(
    resolve(proof.desktopDataDir),
    resolve(request.desktopDataDir),
    "Unexpected native data profile",
  );
  assert.equal(proof.sessionId, request.sessionId, "Wrong saved native session");
  assert(
    proof.migrationVersion > 1 &&
      proof.sessionRead === true &&
      proof.titleVisible === true &&
      proof.historyVisible === true,
    "Native migration/session/history proof incomplete",
  );
  return proof;
}

async function waitUntil(check, child, timeout = 120000) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null || child.spawnFailure)
      throw child.spawnFailure ?? new Error("Owned smoke process exited before its proof");
    try {
      const value = await check();
      if (value) return value;
    } catch (error) {
      last = error;
    }
    await new Promise((done) => setTimeout(done, 100));
  }
  throw new Error(`Smoke readiness/proof timed out: ${last?.message ?? "no proof"}`);
}
function launch(command, args, env, root, name, children) {
  const child = spawn(command, args, {
    cwd: root,
    env,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.spawnFailure = null;
  child.on("error", (error) => {
    child.spawnFailure = error;
  });
  let stdout = "",
    stderr = "";
  child.stdout.on("data", (bytes) => {
    stdout = (stdout + bytes).slice(-32768);
  });
  child.stderr.on("data", (bytes) => {
    stderr = (stderr + bytes).slice(-32768);
  });
  child.once("close", () => {
    writeFileSync(join(root, `${name}.stdout.log`), stdout);
    writeFileSync(join(root, `${name}.stderr.log`), stderr);
  });
  children.push(child);
  return child;
}
async function stopOwned(children) {
  for (const child of [...children].reverse()) {
    if (child.exitCode !== null || child.signalCode !== null || !child.pid) continue;
    const closed = new Promise((done) => child.once("close", done));
    child.kill();
    await Promise.race([closed, new Promise((done) => setTimeout(done, 5000))]);
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
      await Promise.race([closed, new Promise((done) => setTimeout(done, 3000))]);
    }
    assert(child.exitCode !== null || child.signalCode !== null, "Owned smoke child did not stop");
  }
}

export async function main(args = process.argv.slice(2)) {
  const { values } = parseArgs({
    args,
    options: {
      manifest: { type: "string" },
      root: { type: "string" },
      output: { type: "string" },
      plan: { type: "boolean" },
      "local-frozen": { type: "boolean" },
    },
  });
  assert(
    values.manifest && values.root && values.output,
    "Use --manifest <JSON> --root <artifact-root> --output <receipt.json> [--plan]",
  );
  const root = realpathSync(resolve(values.root)),
    manifest = JSON.parse(readFileSync(values.manifest, "utf8"));
  const local = Boolean(values["local-frozen"]);
  const validate = (packageRoot) =>
    local
      ? validateLocalPackageManifest(manifest, packageRoot, { allowLocal: true })
      : validatePackageManifest(manifest, packageRoot, { requireSmoke: false });
  validate(root);
  assertNativeSmokeCapability(readFileSync(join(root, manifest.components.launcher.path)));
  const report = {
    schemaVersion: 1,
    evidence: local ? "local-packaged-native-smoke" : "packaged-native-smoke",
    source: manifest.source,
    version: manifest.version,
    platform: manifest.platform,
    artifactDigest: manifest.artifactDigest,
    buildId: manifest.buildIdentity.buildId,
    status: "failed",
    checks: Object.fromEntries(smokeChecks.map((name) => [name, false])),
    startedAt: new Date().toISOString(),
  };
  if (values.plan) {
    console.log(
      JSON.stringify(
        { ...report, evidence: `${report.evidence}-plan`, launch: "not-run" },
        null,
        2,
      ),
    );
    return 0;
  }
  assert(
    (process.platform === "win32" &&
      manifest.platform === "windows-x64" &&
      process.arch === "x64") ||
      (process.platform === "darwin" &&
        manifest.platform === "macos-arm64" &&
        process.arch === "arm64"),
    "Package smoke requires its real target platform",
  );
  const output = artifactPath(values.output);
  assert(
    !existsSync(output),
    "Smoke receipt output must be new (never accept/overwrite an old receipt)",
  );
  mkdirSync(dirname(output), { recursive: true });
  const save = () => writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
  save();
  const nonce = randomBytes(32).toString("hex"),
    runtime = join(runtimeBase(), `package-smoke-${nonce.slice(0, 20)}`),
    children = [];
  try {
    mkdirSync(runtime);
    report.runtimeDirectory = runtime;
    writeFileSync(
      join(runtime, "owner.json"),
      JSON.stringify({ kind: "bycoda-package-smoke-owned-v1", nonce }),
      { flag: "wx" },
    );
    const payload = join(runtime, "payload");
    if (local) stageLocalPackage(manifest, root, payload, { allowLocal: true });
    else stagePackage(manifest, root, payload);
    validate(payload);
    report.checks.artifactHashes = true;
    const seed = seedOldDatabases(runtime);
    const identifier = `com.bycoda.desktop.smoke.${nonce.slice(0, 20)}`;
    const desktopDataDir = join(runtime, identifier);
    assert(!existsSync(desktopDataDir), "Fresh native profile unexpectedly exists");
    const request = {
      schemaVersion: 1,
      nonce,
      root: realpathSync(runtime),
      home: realpathSync(seed.home),
      desktopDataDir,
      seedDb: seed.seedDb,
      seedSha256: seed.seedSha256,
      proofPath: join(runtime, "native-proof.json"),
      sourceSha: manifest.source.sha,
      sourceFingerprint: manifest.buildIdentity.sourceFingerprint,
      buildId: manifest.buildIdentity.buildId,
      artifactDigest: manifest.artifactDigest,
      version: manifest.version,
      sessionId: seed.sessionId,
      title: seed.title,
      history: seed.history,
    };
    const requestPath = join(runtime, "request.json");
    writeFileSync(requestPath, JSON.stringify(request), { flag: "wx" });
    const hostNode = join(payload, manifest.components.hostNode.path),
      hostEntry = join(payload, manifest.components.hostEntry.path);
    const env = smokeEnvironment(process.env, seed, hostNode);
    Object.assign(env, {
      BYCODA_PACKAGE_SMOKE_REQUEST: requestPath,
      BYCODA_PACKAGE_SMOKE_NONCE: nonce,
      BYCODA_DESKTOP_DB: join(desktopDataDir, "bycoda.db"),
    });
    const port = await reservePort();
    const host = launch(
      hostNode,
      [hostEntry, "serve", "--data-dir", seed.host, "--port", String(port)],
      env,
      runtime,
      "host",
      children,
    );
    const readHealth = async () => {
      const running = JSON.parse(readFileSync(join(seed.host, "running.json"), "utf8"));
      assert(running.pid === host.pid && running.port === port, "Foreign Host endpoint");
      const response = await fetch(`http://127.0.0.1:${port}/lifecycle`, {
        method: "POST",
        headers: { Authorization: `Bearer ${running.secret}`, "Content-Type": "application/json" },
        body: JSON.stringify({ action: "status" }),
        signal: AbortSignal.timeout(1500),
      });
      assert(response.ok, "Isolated Host lifecycle status failed");
      return response.json();
    };
    const health = await waitUntil(readHealth, host);
    assert(
      health.pid === host.pid &&
        health.buildIdentity?.buildId === manifest.buildIdentity.buildId &&
        health.buildIdentity?.head === manifest.source.sha &&
        health.buildIdentity?.sourceFingerprint === manifest.buildIdentity.sourceFingerprint,
      "Packaged Host source identity mismatch",
    );
    report.checks.hostIdentity = true;
    assert.equal(
      resolve(health.runtime),
      resolve(hostEntry),
      "The packaged Host entry differs from the copied payload",
    );
    const migratedHost = new DatabaseSync(join(seed.host, "host.db"), { readOnly: true });
    try {
      assert(
        migratedHost
          .prepare("PRAGMA table_info(sessions)")
          .all()
          .some((column) => column.name === "summary"),
        "Old Host database was not migrated",
      );
      const retained = JSON.parse(
        migratedHost.prepare("SELECT snapshot FROM sessions WHERE id=?").get(seed.sessionId)
          .snapshot,
      );
      assert(
        retained.session.blocks.some((block) => block.text === seed.history),
        "Old Host history changed during startup",
      );
    } finally {
      migratedHost.close();
    }
    const native = launch(
      join(payload, manifest.components.launcher.path),
      ["--package-smoke"],
      env,
      runtime,
      "native",
      children,
    );
    const proof = await waitUntil(
      () =>
        existsSync(request.proofPath) ? JSON.parse(readFileSync(request.proofPath, "utf8")) : null,
      native,
    );
    validateNativeProof(proof, request, manifest, native.pid);
    assert(
      host.exitCode === null &&
        host.signalCode === null &&
        native.exitCode === null &&
        native.signalCode === null,
      "An owned application or Host exited before acceptance",
    );
    const finalHealth = await readHealth();
    assert.equal(finalHealth.pid, host.pid, "The final Host process differs from this run");
    assert.deepEqual(
      finalHealth.buildIdentity,
      health.buildIdentity,
      "Host identity changed while the native history was rendered",
    );
    report.checks.embeddedNativeIdentity = true;
    report.checks.oldDatabaseMigrated = true;
    report.checks.savedSessionRead = true;
    report.checks.historyRendered = true;
    report.proof = {
      native: request.proofPath,
      nativePid: native.pid,
      hostPid: host.pid,
      migrationVersion: proof.migrationVersion,
    };
    report.status = "passed";
  } catch (error) {
    report.error = String(error).slice(0, 4000);
    throw error;
  } finally {
    try {
      await stopOwned(children);
    } catch (error) {
      report.status = "failed";
      report.error = String(error).slice(0, 4000);
    }
    try {
      const directory = `${output}.evidence`;
      mkdirSync(directory);
      report.evidenceFiles = [];
      for (const name of [
        "native-proof.json",
        "host.stdout.log",
        "host.stderr.log",
        "native.stdout.log",
        "native.stderr.log",
      ]) {
        const source = join(runtime, name);
        if (!existsSync(source)) continue;
        assert(
          statSync(source).isFile() && statSync(source).size <= 1024 * 1024,
          "Smoke proof/log exceeded the evidence bound",
        );
        const target = join(directory, name);
        copyFileSync(source, target);
        report.evidenceFiles.push({
          path: target,
          bytes: statSync(target).size,
          sha256: digest(readFileSync(target)),
        });
        if (name === "native-proof.json" && report.proof) report.proof.native = target;
      }
      if (report.status === "passed")
        assert(
          report.evidenceFiles.some((file) => file.path.endsWith("native-proof.json")),
          "Successful native smoke requires its retained real proof",
        );
    } catch (error) {
      report.status = "failed";
      report.error = String(error).slice(0, 4000);
    }
    report.completedAt = new Date().toISOString();
    save();
    console.log(`Packaged native smoke ${report.status}: ${output}`);
  }
  return report.status === "passed" ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
