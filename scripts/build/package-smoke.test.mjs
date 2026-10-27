import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  seedOldDatabases,
  validateNativeProof,
  smokeEnvironment,
  assertNativeSmokeCapability,
  runtimeBase,
} from "./package-smoke.mjs";

test("Windows Host smoke uses an owned local profile rather than a shared checkout's ACLs", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "bycoda-runtime-base-"));
  t.after(() => {
    assert.equal(dirname(directory), tmpdir());
    rmSync(directory, { recursive: true });
  });
  assert.equal(
    runtimeBase({ LOCALAPPDATA: directory }, "win32"),
    join(directory, "bycoda", "package-smoke-runs"),
  );
  assert.throws(() => runtimeBase({}, "win32"), /actual user-local/);
  assert.throws(
    () => runtimeBase({ LOCALAPPDATA: "relative-profile" }, "win32"),
    /actual user-local/,
  );
});

test("an old hash-valid executable that ignores the smoke flag is rejected before any launch", () => {
  assert.throws(
    () => assertNativeSmokeCapability(Buffer.from("old desktop --package-smoke")),
    /rebuild it before launch/,
  );
  assert.throws(
    () =>
      assertNativeSmokeCapability(Buffer.from("BYCODA_PACKAGE_SMOKE_REQUEST native-webview-proof")),
    /rebuild it before launch/,
  );
  assert.doesNotThrow(() =>
    assertNativeSmokeCapability(
      Buffer.from(
        "BYCODA_PACKAGE_SMOKE_REQUEST\0bycoda-package-smoke-owned-v1\0native-webview-proof",
      ),
    ),
  );
});

test("old DB seed contains retained native/Host history without an active provider or inflight operation", (t) => {
  const root = mkdtempSync(join(tmpdir(), "bycoda-package-seed-"));
  t.after(() => {
    assert.equal(dirname(root), tmpdir());
    rmSync(root, { recursive: true });
  });
  const seed = seedOldDatabases(root);
  const db = new DatabaseSync(seed.seedDb, { readOnly: true });
  try {
    assert.equal(
      db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get().version,
      1,
    );
    const session = db.prepare("SELECT * FROM sessions").get();
    assert.equal(session.provider_session_id, null);
    assert(JSON.parse(session.blocks_json).some((block) => block.text === seed.history));
    assert.equal(
      JSON.parse(db.prepare("SELECT snapshot_json FROM workspace_snapshot").get().snapshot_json)
        .sessions[0].id,
      seed.sessionId,
    );
    assert.equal(
      db
        .prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE name='in_flight_sessions'")
        .get().count,
      0,
    );
  } finally {
    db.close();
  }
  const host = new DatabaseSync(join(seed.host, "host.db"), { readOnly: true });
  try {
    assert.equal(
      JSON.parse(host.prepare("SELECT snapshot FROM sessions").get().snapshot).status,
      "idle",
    );
  } finally {
    host.close();
  }
});

test("native proof requires its own process, nonce, exact packaged source and rendered retained history", () => {
  const request = {
    nonce: "a".repeat(64),
    desktopDataDir: join(tmpdir(), "owned-smoke-profile"),
    sessionId: "saved-session",
  };
  const manifest = {
    source: { sha: "b".repeat(40) },
    artifactDigest: "c".repeat(64),
    buildIdentity: { buildId: "immutable-build", sourceFingerprint: "d".repeat(64) },
  };
  const proof = {
    schemaVersion: 1,
    evidence: "native-webview-proof",
    nonce: request.nonce,
    pid: 123,
    sourceSha: manifest.source.sha,
    artifactDigest: manifest.artifactDigest,
    buildIdentity: { ...manifest.buildIdentity, head: manifest.source.sha },
    desktopDataDir: request.desktopDataDir,
    sessionId: request.sessionId,
    migrationVersion: 2,
    sessionRead: true,
    titleVisible: true,
    historyVisible: true,
  };
  assert.equal(validateNativeProof(proof, request, manifest, 123), proof);
  for (const mutation of [
    { nonce: "e".repeat(64) },
    { pid: 456 },
    { sourceSha: "f".repeat(40) },
    { artifactDigest: "0".repeat(64) },
    { migrationVersion: 1 },
    { sessionRead: false },
    { titleVisible: false },
    { historyVisible: false },
    { desktopDataDir: tmpdir() },
    { sessionId: "other" },
    { buildIdentity: { ...proof.buildIdentity, sourceFingerprint: "1".repeat(64) } },
  ])
    assert.throws(() => validateNativeProof({ ...proof, ...mutation }, request, manifest, 123));
});

test("packaged smoke cannot inherit personal provider paths, credentials, SSH agents or development Host overrides", (t) => {
  const root = mkdtempSync(join(tmpdir(), "bycoda-package-env-"));
  t.after(() => {
    assert.equal(dirname(root), tmpdir());
    rmSync(root, { recursive: true });
  });
  const env = smokeEnvironment(
    {
      SystemRoot: "C:\\Windows",
      PATH: "C:\\personal-provider-bin",
      OPENAI_API_KEY: "private",
      CODEX_HOME: "personal",
      SSH_AUTH_SOCK: "agent",
      BYCODA_DEV_HOST_ENTRY: "personal-host",
      TAURI_CONFIG: "personal-profile",
      NODE_OPTIONS: "--require=personal-hook",
      GITHUB_TOKEN: "secret",
    },
    { home: root, host: join(root, ".bycoda-host") },
    join(root, "payload", "node.exe"),
    "win32",
  );
  for (const key of [
    "OPENAI_API_KEY",
    "CODEX_HOME",
    "SSH_AUTH_SOCK",
    "BYCODA_DEV_HOST_ENTRY",
    "TAURI_CONFIG",
    "NODE_OPTIONS",
    "GITHUB_TOKEN",
  ])
    assert.equal(env[key], undefined);
  assert(!env.PATH.includes("personal-provider-bin"));
  assert.equal(env.USERPROFILE, root);
  assert(
    env.APPDATA.startsWith(root) && env.LOCALAPPDATA.startsWith(root) && env.TEMP.startsWith(root),
  );
});
