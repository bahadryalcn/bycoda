/** Deterministic setup decisions. OS facts come only from the PowerShell collector, never a marker. */
import path from "node:path";
import { pathToFileURL } from "node:url";

export const runnerContract = Object.freeze({
  schemaVersion: 1,
  repository: "bahadryalcn/bycoda",
  repositoryId: 1413796716,
  root: "C:\\bycoda-actions",
  account: "bycoda-runner",
  osProfile: "C:\\Users\\bycoda-runner",
  runnerName: "bycoda-windows-isolated-01",
  labels: ["self-hosted", "Windows", "X64", "bycoda-windows-isolated"],
  lifecycle: "persistent-single-isolated-vm",
  release: {
    version: "2.338.2",
    name: "actions-runner-win-x64-2.338.2.zip",
    bytes: 104210683,
    sha256: "a1f17aa987fc8158bc7521d284912267a0d01b7c2c4684b33c86783b5e8221cc",
    url: "https://github.com/actions/runner/releases/download/v2.338.2/actions-runner-win-x64-2.338.2.zip",
  },
});

const samePath = (a, b) =>
  typeof a === "string" &&
  path.win32.resolve(a).toLowerCase() === path.win32.resolve(b).toLowerCase();
const sid = (value) => typeof value === "string" && /^S-1-5-21-\d+-\d+-\d+-\d+$/.test(value);
const guest = (machine) =>
  machine?.hypervisor === true &&
  typeof machine.uuid === "string" &&
  /^[a-f0-9-]{36}$/i.test(machine.uuid) &&
  !/^(?:0|-)+$/.test(machine.uuid) &&
  /^(Microsoft Corporation|VMware, Inc\.|innotek GmbH|Oracle Corporation|QEMU|Red Hat|Amazon EC2|Google)$/i.test(
    machine.manufacturer ?? "",
  ) &&
  /Virtual Machine|VMware Virtual Platform|VirtualBox|KVM|QEMU|HVM domU|Google Compute Engine/i.test(
    machine.model ?? "",
  );

export function runnerEnvironment(purpose) {
  if (!["ci", "package"].includes(purpose)) throw new Error("Unknown runner purpose");
  const r = runnerContract.root;
  return {
    BYCODA_WINDOWS_RUNNER_ROOT: r,
    BYCODA_WINDOWS_RUNNER_WORK_ROOT: `${r}\\work`,
    BYCODA_WINDOWS_RUNNER_CACHE_ROOT: `${r}\\cache`,
    BYCODA_WINDOWS_RUNNER_PROFILE_ROOT: `${r}\\profile`,
    CARGO_HOME: `${r}\\cache\\cargo-home`,
    RUSTUP_HOME: `${r}\\cache\\rustup-home`,
    CARGO_TARGET_DIR: `${r}\\cache\\cargo-target\\${purpose === "package" ? "release" : "ci"}`,
    npm_config_store_dir: `${r}\\cache\\pnpm-store`,
    PNPM_HOME: `${r}\\cache\\pnpm-home`,
    NPM_CONFIG_CACHE: `${r}\\cache\\npm`,
    XDG_CACHE_HOME: `${r}\\cache\\xdg`,
    TEMP: `${r}\\work\\_temp`,
    TMP: `${r}\\work\\_temp`,
  };
}

export function evaluateRunner(facts, { mode = "Plan", purpose = "ci" } = {}) {
  if (
    !["Plan", "Status", "Prepare", "Register", "Run", "Verify"].includes(mode) ||
    !["ci", "package"].includes(purpose)
  )
    throw new Error("Unsupported runner operation");
  const blockers = [];
  const need = (pass, code, owner) => {
    if (pass !== true) blockers.push({ code, owner });
  };
  const prep = mode === "Prepare";
  const admin = prep || mode === "Register";
  need(
    facts?.platform === "win32" && facts.architecture === "X64",
    "windows-x64-required",
    "VM administrator",
  );
  need(
    guest(facts?.machine),
    "actual-dedicated-windows-guest-required",
    "Hyper-V/VM administrator",
  );
  need(
    facts?.target?.name?.toLowerCase() === runnerContract.account &&
      sid(facts.target.sid) &&
      facts.target.nonAdmin === true &&
      facts.target.enabled === true &&
      samePath(facts.target.profile, runnerContract.osProfile),
    "dedicated-nonadmin-identity-and-real-profile-required",
    "VM administrator",
  );
  need(
    facts?.paths?.fixedRoots === true && facts.paths.reparseFree === true,
    "fixed-local-roots-without-reparse-points-required",
    "VM administrator",
  );
  need(
    facts?.machine?.noHostShares === true,
    "host-shares-or-unverified-sharing-forbidden",
    "Hyper-V/VM administrator",
  );
  need(
    facts?.machine?.noInstalledPersonalHost === true,
    "personal-bycoda-host-or-service-forbidden",
    "VM administrator",
  );
  if (admin)
    need(
      facts?.current?.administrator === true,
      "guest-administrator-required-for-protected-setup",
      "VM administrator",
    );
  else if (!["Plan", "Status"].includes(mode))
    need(
      Boolean(facts?.current?.sid) &&
        facts.current.sid === facts?.target?.sid &&
        facts.current.administrator === false &&
        samePath(facts.current.profile, runnerContract.osProfile),
      "run-as-dedicated-nonadmin-account-required",
      "VM operator",
    );
  if (mode === "Run" || (purpose === "package" && mode === "Verify"))
    need(
      facts?.current?.interactive === true &&
        Number.isInteger(facts.current.sessionId) &&
        facts.current.sessionId > 0,
      "interactive-non-session-zero-desktop-required",
      "VM operator",
    );
  if (prep) {
    need(
      facts?.archive?.verified === true,
      "exact-official-runner-archive-required",
      "Setup operator",
    );
    need(
      facts?.tools?.node24ProtectedSigned === true &&
        facts.tools.pwsh7Protected === true &&
        facts.tools.frameworkCompiler === true,
      "protected-node24-pwsh7-and-framework-compiler-required",
      "VM administrator",
    );
    need(
      facts?.sources?.complete === true,
      "reviewed-setup-and-trust-hook-sources-required",
      "Repository owner",
    );
    need(
      facts?.paths?.rootAbsent === true ||
        (facts?.prepared?.trusted === true && facts.prepared.hashes === true),
      "existing-unowned-runner-root-must-not-be-modified",
      "VM administrator",
    );
  } else {
    const policy = facts?.policy;
    need(
      policy?.schemaVersion === 1 &&
        policy.repository === runnerContract.repository &&
        policy.repositoryId === runnerContract.repositoryId &&
        policy.lifecycle === runnerContract.lifecycle &&
        policy.runnerVersion === runnerContract.release.version &&
        policy.runnerSid === facts?.target?.sid &&
        policy.machineUuid === facts?.machine?.uuid &&
        JSON.stringify(policy.labels) === JSON.stringify(runnerContract.labels),
      "matching-protected-policy-required",
      "VM administrator",
    );
    need(
      facts?.prepared?.trusted === true &&
        facts.prepared.hashes === true &&
        facts.prepared.profilesDisabledByShim === true,
      "admin-owned-immutable-control-hook-runtime-and-launcher-required",
      "VM administrator",
    );
    need(
      facts?.network?.privateEgressBlocked === true && facts.network.redirectionDisabled === true,
      "guest-firewall-and-redirection-isolation-required",
      "VM administrator",
    );
    if (!["Plan", "Status", "Register"].includes(mode))
      need(
        facts?.runner?.registered === true &&
          facts.runner.matches === true &&
          facts.runner.protectedConfig === true,
        "registered-pinned-protected-runner-required",
        "Setup operator",
      );
  }
  if (["Prepare", "Register", "Run"].includes(mode))
    need(
      facts?.runner?.listenerActive === false,
      "another-runner-listener-is-already-active",
      "VM operator",
    );
  need(facts?.runner?.serviceInstalled === false, "runner-service-mode-forbidden", "VM operator");
  return {
    schemaVersion: 1,
    mode,
    purpose,
    allowed: blockers.length === 0,
    status: blockers.length
      ? "blocked"
      : prep
        ? facts.paths.rootAbsent
          ? "ready-to-prepare"
          : "already-prepared"
        : mode === "Register"
          ? facts.runner?.registered
            ? "already-registered"
            : "ready-to-register"
          : mode === "Run"
            ? "ready-to-run"
            : "verified",
    blockers,
    repository: runnerContract.repository,
    lifecycle: runnerContract.lifecycle,
    runnerVersion: runnerContract.release.version,
    payloadState: facts?.archive?.verified
      ? "verified-staged-archive-only"
      : "archive-unverified-or-not-supplied",
    protectedProvisioning: facts?.prepared?.trusted === true && facts?.prepared?.hashes === true,
    activationPerformed: false,
    environment: runnerEnvironment(purpose),
    limitation:
      "Source decisions and a staged ZIP do not provision a VM or prove a live GitHub job. Public PR labels/if conditions are not a trust boundary. Protected process pre-job admission plus actual VM/account isolation are mandatory.",
  };
}

export function safeArchiveEntries(entries) {
  if (!Array.isArray(entries) || !entries.length || entries.length > 20000) return false;
  let bytes = 0;
  return entries.every((entry) => {
    const name = typeof entry?.name === "string" ? entry.name.replaceAll("\\", "/") : "";
    bytes += entry?.bytes;
    return (
      name.length > 0 &&
      !name.startsWith("/") &&
      // Archive control bytes and ADS separators are intentionally rejected.
      // eslint-disable-next-line no-control-regex
      !/[\x00-\x1f:]/.test(name) &&
      name
        .split("/")
        .filter(Boolean)
        .every(
          (part) =>
            part !== "." &&
            part !== ".." &&
            !/[. ]$/.test(part) &&
            !/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(part),
        ) &&
      Number.isSafeInteger(entry.bytes) &&
      entry.bytes >= 0 &&
      bytes <= 1_073_741_824 &&
      entry.link !== true
    );
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [mode, purpose] = process.argv.slice(2);
  let input = "";
  for await (const chunk of process.stdin) {
    input += chunk;
    if (input.length > 4 * 1024 * 1024) throw new Error("Runner facts exceed bound");
  }
  const report = evaluateRunner(JSON.parse(input), { mode, purpose });
  console.log(JSON.stringify(report));
  if (!report.allowed && !["Plan", "Status"].includes(mode)) process.exitCode = 2;
}
