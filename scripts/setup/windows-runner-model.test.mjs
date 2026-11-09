import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  evaluateRunner,
  runnerContract,
  runnerEnvironment,
  safeArchiveEntries,
} from "./windows-runner-model.mjs";

const runnerSid = "S-1-5-21-111-222-333-1002";
function ready() {
  return {
    platform: "win32",
    architecture: "X64",
    machine: {
      hypervisor: true,
      uuid: "11111111-2222-3333-4444-555555555555",
      manufacturer: "Microsoft Corporation",
      model: "Virtual Machine",
      noHostShares: true,
      noInstalledPersonalHost: true,
    },
    target: {
      name: "bycoda-runner",
      sid: runnerSid,
      nonAdmin: true,
      enabled: true,
      profile: "C:\\Users\\bycoda-runner",
    },
    current: {
      sid: runnerSid,
      administrator: false,
      profile: "C:\\Users\\bycoda-runner",
      interactive: true,
      sessionId: 2,
    },
    paths: { fixedRoots: true, reparseFree: true, rootAbsent: false },
    archive: { verified: true },
    tools: { node24ProtectedSigned: true, pwsh7Protected: true, frameworkCompiler: true },
    sources: { complete: true },
    policy: {
      schemaVersion: 1,
      repository: runnerContract.repository,
      repositoryId: runnerContract.repositoryId,
      lifecycle: runnerContract.lifecycle,
      runnerVersion: runnerContract.release.version,
      runnerSid,
      machineUuid: "11111111-2222-3333-4444-555555555555",
      labels: [...runnerContract.labels],
    },
    prepared: { trusted: true, hashes: true, profilesDisabledByShim: true },
    network: { privateEgressBlocked: true, redirectionDisabled: true },
    runner: {
      registered: true,
      matches: true,
      protectedConfig: true,
      serviceInstalled: false,
      listenerActive: false,
    },
  };
}
const denied = (facts, code, options = { mode: "Verify" }) => {
  const report = evaluateRunner(facts, options);
  assert.equal(report.allowed, false);
  assert.ok(
    report.blockers.some((b) => b.code === code),
    JSON.stringify(report.blockers),
  );
};

test("complete isolated guest can verify both purposes; package cache stays outside checkout", () => {
  for (const purpose of ["ci", "package"]) {
    const report = evaluateRunner(ready(), { mode: "Verify", purpose });
    assert.equal(report.allowed, true);
    assert.equal(report.activationPerformed, false);
    assert.equal(
      report.environment.CARGO_TARGET_DIR,
      `C:\\bycoda-actions\\cache\\cargo-target\\${purpose === "ci" ? "ci" : "release"}`,
    );
    assert.ok(Object.values(report.environment).every((p) => p.startsWith("C:\\bycoda-actions")));
  }
});
test("VM marker cannot promote a physical virtualization-capable workstation", () => {
  for (const patch of [
    { model: "Precision 3660", manufacturer: "Dell Inc." },
    { hypervisor: false },
    { uuid: "00000000-0000-0000-0000-000000000000" },
  ]) {
    const facts = ready();
    Object.assign(facts.machine, patch);
    facts.marker = "isolated";
    denied(facts, "actual-dedicated-windows-guest-required");
  }
});
test("a name or USERPROFILE override cannot substitute for actual SID/profile/nonadmin identity", () => {
  for (const change of [
    (f) => (f.current.sid = "S-1-5-21-111-222-333-1001"),
    (f) => (f.current.profile = "C:\\Users\\kraba"),
    (f) => (f.current.administrator = true),
    (f) => (f.target.nonAdmin = false),
    (f) => (f.target.profile = "C:\\Users\\personal"),
    (f) => (f.target.enabled = false),
  ]) {
    const facts = ready();
    change(facts);
    assert.equal(evaluateRunner(facts, { mode: "Run" }).allowed, false);
  }
});
test("host shares, personal Host, reparse paths and service mode each independently deny", () => {
  const cases = [
    ["machine", "noHostShares", "host-shares-or-unverified-sharing-forbidden"],
    ["machine", "noInstalledPersonalHost", "personal-bycoda-host-or-service-forbidden"],
    ["paths", "reparseFree", "fixed-local-roots-without-reparse-points-required"],
    ["network", "privateEgressBlocked", "guest-firewall-and-redirection-isolation-required"],
    ["network", "redirectionDisabled", "guest-firewall-and-redirection-isolation-required"],
  ];
  for (const [section, key, code] of cases) {
    const f = ready();
    f[section][key] = false;
    denied(f, code);
  }
  const f = ready();
  f.runner.serviceInstalled = true;
  denied(f, "runner-service-mode-forbidden");
});
test("policy is bound to exact machine, account, repository, runner payload and label set", () => {
  for (const [key, value] of [
    ["machineUuid", "other"],
    ["runnerSid", "S-1-5-21-9-9-9-1002"],
    ["repository", "attacker/bycoda"],
    ["repositoryId", 1],
    ["runnerVersion", "2.338.1"],
    ["lifecycle", "personal-persistent"],
    ["labels", ["self-hosted"]],
  ]) {
    const f = ready();
    f.policy[key] = value;
    denied(f, "matching-protected-policy-required");
  }
});
test("hash drift, writable hooks, profile loading, and mutable registration each deny", () => {
  for (const key of ["trusted", "hashes", "profilesDisabledByShim"]) {
    const f = ready();
    f.prepared[key] = false;
    denied(f, "admin-owned-immutable-control-hook-runtime-and-launcher-required");
  }
  for (const key of ["registered", "matches", "protectedConfig"]) {
    const f = ready();
    f.runner[key] = false;
    denied(f, "registered-pinned-protected-runner-required");
  }
});
test("real desktop session is mandatory for package and Run; CI cannot start a Session0 listener", () => {
  const f = ready();
  f.current.sessionId = 0;
  f.current.interactive = false;
  denied(f, "interactive-non-session-zero-desktop-required", {
    mode: "Verify",
    purpose: "package",
  });
  denied(f, "interactive-non-session-zero-desktop-required", { mode: "Run" });
  f.current.sessionId = 2;
  f.current.interactive = true;
  f.runner.listenerActive = true;
  denied(f, "another-runner-listener-is-already-active", { mode: "Run" });
});
test("Prepare is explicit elevated guest-only, pin-verified and idempotent, preserving existing roots", () => {
  const f = ready();
  f.current.administrator = true;
  f.paths.rootAbsent = true;
  f.prepared = { trusted: false, hashes: false };
  assert.equal(evaluateRunner(f, { mode: "Prepare" }).status, "ready-to-prepare");
  f.archive.verified = false;
  denied(f, "exact-official-runner-archive-required", { mode: "Prepare" });
  f.archive.verified = true;
  f.paths.rootAbsent = false;
  denied(f, "existing-unowned-runner-root-must-not-be-modified", { mode: "Prepare" });
  f.prepared = { trusted: true, hashes: true };
  assert.equal(evaluateRunner(f, { mode: "Prepare" }).status, "already-prepared");
  f.prepared.hashes = false;
  denied(f, "existing-unowned-runner-root-must-not-be-modified", { mode: "Prepare" });
});
test("Register never silently replaces or starts an existing runner", () => {
  const f = ready();
  f.current.administrator = true;
  assert.equal(evaluateRunner(f, { mode: "Register" }).status, "already-registered");
  f.runner.registered = false;
  assert.equal(evaluateRunner(f, { mode: "Register" }).status, "ready-to-register");
  f.current.administrator = false;
  denied(f, "guest-administrator-required-for-protected-setup", { mode: "Register" });
});
test("Plan/Status remain honest blocked reports; unsupported modes/purposes are rejected", () => {
  for (const mode of ["Plan", "Status"]) assert.equal(evaluateRunner({}, { mode }).allowed, false);
  assert.throws(() => evaluateRunner(ready(), { mode: "InstallService" }));
  assert.throws(() => runnerEnvironment("shell"));
});
test("archive inventory rejects traversal, reserved names, ADS, links, bombs and absent names", () => {
  assert.equal(
    safeArchiveEntries([
      { name: "bin/Runner.Listener.exe", bytes: 500 },
      { name: "externals/", bytes: 0 },
    ]),
    true,
  );
  for (const name of [
    "../escape.exe",
    "bin/../../escape.exe",
    "C:\\escape.exe",
    "\\\\host\\share",
    "/root",
    "bin/NUL.txt",
    "bin/a. ",
    "bin/a:stream",
    "bin/a\u0000",
    "",
  ])
    assert.equal(safeArchiveEntries([{ name, bytes: 5 }]), false, name);
  assert.equal(safeArchiveEntries([{ name: "link", bytes: 1, link: true }]), false);
  assert.equal(safeArchiveEntries([{ name: "large", bytes: 1_073_741_825 }]), false);
  assert.equal(safeArchiveEntries([{ name: "bad", bytes: -1 }]), false);
  assert.equal(safeArchiveEntries([]), false);
});
test("CLI denial has machine-readable JSON and exit2; read-only Plan exits0", () => {
  for (const mode of ["Plan", "Verify"]) {
    const result = spawnSync(
      process.execPath,
      ["scripts/setup/windows-runner-model.mjs", mode, "ci"],
      { input: "{}", encoding: "utf8", windowsHide: true },
    );
    assert.equal(result.status, mode === "Plan" ? 0 : 2);
    assert.equal(JSON.parse(result.stdout).allowed, false);
  }
});
test(
  "PowerShell setup parses without invoking setup operations",
  { skip: process.platform !== "win32" },
  () => {
    // Never invokes Prepare/Register/Run. No fixture is presented as machine isolation.
    const command =
      "$t=$null; $e=$null; [System.Management.Automation.Language.Parser]::ParseFile((Join-Path $PWD 'scripts/setup/windows-runner.ps1'),[ref]$t,[ref]$e)|Out-Null; if($e.Count){$e|ForEach-Object Message; exit 1}";
    const result = spawnSync("pwsh", ["-NoProfile", "-Command", command], {
      encoding: "utf8",
      windowsHide: true,
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const source = readFileSync(new URL("./windows-runner.ps1", import.meta.url), "utf8");
    assert.match(source, /Environment\.Clear\(\)/);
    assert.match(source, /ACTIONS_RUNNER_INPUT_TOKEN/);
    assert.doesNotMatch(source, /--token|--replace|--runasservice|--ephemeral/);
  },
);
