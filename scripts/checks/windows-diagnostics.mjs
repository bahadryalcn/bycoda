/** Optional manual source diagnostics, independent of required Windows CI/native acceptance. */
import fs from "node:fs";
import path from "node:path";
import { spawnSync, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";

export const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const inside = (root, file) => {
  const relative = path.relative(root, file);
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
};
const hash = (file) => createHash("sha256").update(fs.readFileSync(file)).digest("hex");

export function diagnosticOptions(args) {
  const result = { timeoutMs: 120000 };
  const seen = new Set();
  for (let index = 0; index < args.length; index++) {
    const key = args[index];
    if (seen.has(key)) throw new Error(`Duplicate option ${key}`);
    seen.add(key);
    if (key === "--run") result.run = true;
    else if (
      ["--suite", "--file", "--output", "--timeout-ms"].includes(key) &&
      args[index + 1] &&
      !args[index + 1].startsWith("--")
    ) {
      const value = args[++index];
      if (key === "--timeout-ms") {
        const number = Number(value);
        if (!Number.isSafeInteger(number) || number < 1000 || number > 600000)
          throw new Error("Timeout must be 1000–600000 ms");
        result.timeoutMs = number;
      } else result[key.slice(2)] = value;
    } else throw new Error(`Unknown or missing option ${key}`);
  }
  return result;
}

export function diagnosticPlan({ suite, file, timeoutMs = 120000 }, root = repositoryRoot) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 600000)
    throw new Error("Invalid bounded diagnostic timeout");
  if (
    typeof file !== "string" ||
    !/^[A-Za-z0-9_./-]+$/.test(file) ||
    file.split("/").some((segment) => !segment || segment === "." || segment === "..")
  )
    throw new Error("An explicit repository-relative test file is required");
  const allowed =
    suite === "host"
      ? /^host\/.+\.test\.ts$/.test(file)
      : suite === "web"
        ? /^src\/.+\.test\.ts$/.test(file)
        : suite === "scripts"
          ? /^(scripts|\.github\/scripts)\/.+\.test\.(mjs|cjs)$/.test(file)
          : suite === "package-contracts"
            ? [
                "scripts/build/host-inputs.test.mjs",
                "scripts/release/release-candidate.test.mjs",
              ].includes(file)
            : suite === "local-update"
              ? /^scripts\/local-update\/test_[A-Za-z0-9_]+\.py$/.test(file)
              : false;
  if (!allowed) throw new Error("Suite/file combination is outside the diagnostic allowlist");
  const canonicalRoot = fs.realpathSync(root);
  const absolute = fs.realpathSync(path.join(canonicalRoot, file));
  if (!inside(canonicalRoot, absolute) || !fs.statSync(absolute).isFile())
    throw new Error("Selected test must resolve to a regular file inside this checkout");
  const command = suite === "local-update" ? "python" : process.execPath;
  const args =
    suite === "local-update"
      ? [
          "-m",
          "unittest",
          "discover",
          "-s",
          "scripts/local-update",
          "-p",
          path.basename(file),
          "-v",
        ]
      : ["host", "web"].includes(suite)
        ? [path.join(canonicalRoot, "scripts/checks/windows-diagnostics-vitest.mjs"), suite, file]
        : ["--test", absolute];
  return {
    schemaVersion: 1,
    suite,
    file,
    command,
    args,
    timeoutMs,
    interpretation:
      "One manual source test file. No app/Host package build, install, live production state or required-CI replacement.",
  };
}

function identity(root, plan) {
  const git = (...args) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8", windowsHide: true }).trim();
  return {
    gitSha: git("rev-parse", "HEAD"),
    dirty: !!git("status", "--porcelain", "--untracked-files=normal"),
    selectedFileSha256: hash(path.join(root, plan.file)),
    packageManifestSha256: hash(path.join(root, "package.json")),
    configSha256: ["host", "web"].includes(plan.suite)
      ? hash(path.join(root, plan.suite === "host" ? "host/vitest.config.ts" : "vitest.config.ts"))
      : null,
  };
}

export function runDiagnostic(
  options,
  { root = repositoryRoot, platform = process.platform, run = spawnSync, source = identity } = {},
) {
  const plan = diagnosticPlan(options, root);
  const before = source(root, plan);
  if (!options.run) return { ...plan, status: "plan-only", sourceIdentity: before };
  if (platform !== "win32")
    throw new Error(
      "Windows diagnostics --run requires Windows; other platforms are not Windows acceptance",
    );
  if (typeof options.output !== "string" || path.isAbsolute(options.output))
    throw new Error("--output must be a new relative temp/verification directory");
  const base = path.resolve(root, "temp/verification");
  const output = path.resolve(root, options.output);
  if (output === base || !inside(base, output))
    throw new Error("Diagnostic output must stay under temp/verification/");
  for (let parent = output; inside(root, parent); parent = path.dirname(parent)) {
    if (fs.existsSync(parent) && fs.lstatSync(parent).isSymbolicLink())
      throw new Error("Diagnostic output cannot traverse a link/junction");
    if (parent === root) break;
  }
  if (fs.existsSync(output))
    throw new Error("Existing diagnostic evidence is preserved; choose a new output directory");
  fs.mkdirSync(output, { recursive: true });
  const started = new Date().toISOString();
  const result = run(plan.command, plan.args, {
    cwd: root,
    shell: false,
    windowsHide: true,
    encoding: null,
    timeout: plan.timeoutMs,
    maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, CI: "true" },
  });
  fs.writeFileSync(path.join(output, "stdout.log"), result.stdout ?? "");
  fs.writeFileSync(path.join(output, "stderr.log"), result.stderr ?? "");
  const after = source(root, plan);
  const drift = JSON.stringify(before) !== JSON.stringify(after);
  const report = {
    ...plan,
    status: drift
      ? "source-drift"
      : result.error?.code === "ETIMEDOUT"
        ? "timed-out"
        : result.error
          ? "execution-error"
          : result.status === 0
            ? "passed"
            : "failed",
    sourceIdentity: before,
    sourceIdentityAfter: after,
    sourceChangedDuringRun: drift,
    started,
    finished: new Date().toISOString(),
    exitCode: result.status ?? null,
    signal: result.signal ?? null,
    errorCode: result.error?.code ?? null,
    rawLogs: ["stdout.log", "stderr.log"],
    installedBuildInclusion: "unknown; no product build/install was performed",
  };
  fs.writeFileSync(path.join(output, "diagnostic.json"), JSON.stringify(report, null, 2) + "\n");
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = diagnosticOptions(process.argv.slice(2));
  const report = runDiagnostic(args);
  console.log(JSON.stringify(report, null, 2));
  if (args.run && report.status !== "passed") process.exitCode = 1;
}
