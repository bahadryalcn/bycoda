/**
 * Whole-repository mirror of the cheap, deterministic CI gates (repository-hygiene,
 * preflight, scripts, browser inventory and type checks). It runs every gate, even
 * after a failure, so one local run reports what CI would otherwise reveal one push at
 * a time. It never installs, builds, starts browsers or runs the full test suites.
 */
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { repositoryRoot } from "./ci-changes.mjs";
import { localSourceIdentity } from "./check-local.mjs";

const node = (...args) => [process.execPath, ...args];
// Resolve installed tool entry points from their manifests; this runner never installs.
const bin = (name, ...args) => binary(name, name, ...args);
const binary = (name, binName, ...args) => {
  const manifest = JSON.parse(
    readFileSync(path.join(repositoryRoot, "node_modules", name, "package.json"), "utf8"),
  );
  const entry = typeof manifest.bin === "string" ? manifest.bin : manifest.bin?.[binName];
  if (!entry) throw new Error(`Installed ${name} executable is unavailable`);
  return node(path.join("node_modules", name, entry), ...args);
};

/** Each gate names the CI job that runs the same command. */
export const preflightGates = [
  {
    job: "repository-hygiene",
    name: "Tracked ignored files",
    command: node("scripts/checks/check-repository-hygiene.mjs"),
  },
  {
    job: "repository-hygiene",
    name: "Issue label scripts",
    command: node("--test", ".github/scripts/issue-labels.test.cjs"),
  },
  {
    job: "repository-hygiene",
    name: "Formatting (vp fmt, whole repo)",
    command: binary("vite-plus", "vp", "fmt", "--check", "."),
  },
  {
    job: "repository-hygiene",
    name: "Lint debt baseline",
    command: node("scripts/checks/check-lint-baseline.mjs"),
    slow: true,
  },
  { job: "repository-hygiene", name: "Locales", command: node("scripts/i18n/check-locales.mjs") },
  {
    job: "repository-hygiene",
    name: "Feature skills",
    command: node("scripts/checks/check-feature-skills.mjs"),
  },
  {
    job: "repository-hygiene",
    name: "Theme colors",
    command: node("scripts/checks/check-theme-colors.mjs"),
  },
  {
    job: "repository-hygiene",
    name: "UI drift ratchet",
    command: node("scripts/checks/check-ui-drift.mjs"),
  },
  {
    job: "web",
    name: "React Compiler coverage ratchet",
    command: node("scripts/checks/check-compiler-coverage.mjs"),
  },
  {
    job: "repository-hygiene",
    name: "Code structure ratchet",
    command: node("scripts/checks/check-code-structure.mjs"),
  },
  {
    job: "repository-hygiene",
    name: "UI component catalog",
    command: node("scripts/checks/ui-catalog.mjs"),
  },
  {
    job: "repository-hygiene",
    name: "Baseline guard (no raised ratchet without an approval)",
    command: node("scripts/checks/check-baselines.mjs"),
  },
  {
    job: "preflight",
    name: "Host contracts",
    command: node("scripts/checks/check-host-contracts.mjs"),
  },
  {
    job: "preflight",
    name: "Host runtime boundaries",
    command: node("scripts/checks/check-host-runtime-boundaries.mjs"),
  },
  {
    job: "preflight",
    name: "Host headless boundaries",
    command: node("scripts/checks/check-host-headless-boundaries.mjs"),
  },
  {
    job: "preflight",
    name: "Rust formatting (cargo fmt --all)",
    command: ["cargo", "fmt", "--all", "--check"],
  },
  {
    job: "web",
    name: "Workspace package boundaries",
    command: node("scripts/checks/check-package-boundaries.mjs"),
  },
  {
    job: "web",
    name: "Rule set (one definition per rule, generated list current)",
    command: node("scripts/checks/rule-index.mjs"),
  },
  {
    job: "web",
    name: "Code invariants ratchet",
    command: node("scripts/checks/check-invariants.mjs"),
  },
  {
    job: "web",
    name: "Application types (tsc-rs --fast)",
    command: bin("tsc-rs", "--noEmit", "--fast"),
  },
  {
    job: "web",
    name: "Test file types ratchet",
    command: node("scripts/checks/check-test-types.mjs"),
  },
  {
    job: "host",
    name: "Host types (tsc-rs --fast)",
    command: bin("tsc-rs", "--noEmit", "--fast", "-p", "host/tsconfig.json"),
  },
  {
    job: "scripts",
    name: "Script fixture tests",
    command: node("scripts/checks/check-local.mjs", "--scripts", "--run", "--timeout-ms", "600000"),
  },
  {
    job: "scripts",
    name: "Evaluation harness types",
    command: bin("tsc-rs", "--noEmit", "-p", "evals/tsconfig.json"),
  },
  {
    job: "scripts",
    name: "Offline evaluation graders",
    command: bin("vitest", "run", "--config", "evals/vitest.config.ts"),
  },
  {
    job: "browser",
    name: "Browser manifest ownership",
    command: node("scripts/checks/browser-test-inventory.mjs", "--check"),
  },
  {
    job: "browser",
    name: "Browser fixture types",
    command: bin("tsc-rs", "--noEmit", "-p", "tests/browser/tsconfig.json"),
  },
];

export function preflightOptions(args) {
  const options = {
    concurrency: Math.max(1, Math.min(6, Math.floor(availableParallelism() / 2))),
    timeoutMs: 300000,
  };
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (["--list", "--skip-slow"].includes(argument))
      options[argument === "--list" ? "list" : "skipSlow"] = true;
    else if (["--only", "--report", "--concurrency", "--timeout-ms"].includes(argument)) {
      const value = args[++index];
      if (!value || value.startsWith("--")) throw new Error(`Missing value for ${argument}`);
      if (argument === "--only")
        options.only = value
          .split(",")
          .map((entry) => entry.trim())
          .filter(Boolean);
      else if (argument === "--report") options.report = value;
      else {
        const number = Number(value);
        const max = argument === "--concurrency" ? 16 : 1800000;
        if (!Number.isSafeInteger(number) || number < 1 || number > max)
          throw new Error(`Invalid bounded value for ${argument}`);
        options[argument === "--concurrency" ? "concurrency" : "timeoutMs"] = number;
      }
    } else throw new Error(`Unknown option: ${argument}`);
  }
  return options;
}

export function selectGates(gates, { only, skipSlow } = {}) {
  if (only) {
    const unknown = only.filter((job) => !gates.some((gate) => gate.job === job));
    if (unknown.length) throw new Error(`Unknown CI job for --only: ${unknown.join(", ")}`);
  }
  return gates.filter((gate) => (!only || only.includes(gate.job)) && !(skipSlow && gate.slow));
}

function runGate(gate, { root, timeoutMs }) {
  const started = Date.now();
  return new Promise((resolve) => {
    const [command, ...args] = gate.command;
    const child = spawn(command, args, {
      cwd: root,
      windowsHide: true,
      detached: process.platform !== "win32",
    });
    const chunks = [];
    let size = 0;
    const collect = (chunk) => {
      // Keep the tail bounded: failures are read from the end of the output.
      chunks.push(chunk);
      size += chunk.length;
      while (size > 256 * 1024 && chunks.length > 1) size -= chunks.shift().length;
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        if (process.platform === "win32")
          execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
            windowsHide: true,
            stdio: "ignore",
            timeout: 10000,
          });
        else process.kill(-child.pid, "SIGKILL");
      } catch {
        /* The owned child may already have exited. */
      }
    }, timeoutMs);
    const finish = (exitCode) => {
      clearTimeout(timer);
      resolve({
        ...gate,
        exitCode,
        timedOut,
        durationMs: Date.now() - started,
        output: Buffer.concat(chunks).toString("utf8"),
      });
    };
    child.once("error", (error) => {
      chunks.push(Buffer.from(String(error.message)));
      finish(1);
    });
    child.once("close", (code) => finish(code ?? 1));
  });
}

export async function runPreflight(
  gates,
  { root = repositoryRoot, concurrency = 4, timeoutMs = 300000, onResult = () => {} } = {},
) {
  const results = Array.from({ length: gates.length });
  let next = 0;
  const worker = async () => {
    while (next < gates.length) {
      const index = next++;
      results[index] = await runGate(gates[index], { root, timeoutMs });
      onResult(results[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, gates.length) }, worker));
  return results;
}

// Strips ANSI color sequences from captured tool output before printing its tail.
const ansi = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");
const tail = (text, lines = 40) =>
  text.replace(ansi, "").trimEnd().split(/\r?\n/).slice(-lines).join("\n");

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const options = preflightOptions(process.argv.slice(2));
  const gates = selectGates(preflightGates, options);
  if (options.list) {
    for (const gate of gates)
      console.log(`${gate.job.padEnd(20)} ${gate.name}: ${gate.command.join(" ")}`);
    process.exit(0);
  }
  const started = Date.now();
  console.log(`CI preflight: ${gates.length} gates, ${options.concurrency} at a time`);
  const results = await runPreflight(gates, {
    ...options,
    onResult: (result) =>
      console.log(
        `${result.exitCode === 0 && !result.timedOut ? "ok  " : "FAIL"} ${result.job} / ${result.name} (${(result.durationMs / 1000).toFixed(1)}s)`,
      ),
  });
  const failed = results.filter((result) => result.exitCode !== 0 || result.timedOut);
  for (const result of failed) {
    console.log(
      `\n--- ${result.job} / ${result.name}${result.timedOut ? " (timed out)" : ""}: ${result.command.join(" ")}`,
    );
    console.log(tail(result.output));
  }
  const report = {
    schemaVersion: 1,
    ...localSourceIdentity(),
    durationMs: Date.now() - started,
    results: results.map(({ output: _output, ...result }) => result),
    deferred: [
      "Full vitest suites, browser fixtures, cargo clippy/test, RPM/native builds and three-OS runs stay CI-owned",
    ],
    success: failed.length === 0,
  };
  if (options.report) {
    const file = path.resolve(repositoryRoot, options.report);
    const relative = path.relative(path.join(repositoryRoot, "temp"), file);
    if (relative.startsWith("..") || path.isAbsolute(relative))
      throw new Error("Preflight reports must be under temp/");
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`);
  }
  console.log(
    failed.length
      ? `\nCI preflight failed: ${failed.length}/${results.length} gates (${(report.durationMs / 1000).toFixed(0)}s). CI would fail on the same commands.`
      : `\nCI preflight passed: ${results.length} gates (${(report.durationMs / 1000).toFixed(0)}s).`,
  );
  if (failed.length) process.exitCode = 1;
}
