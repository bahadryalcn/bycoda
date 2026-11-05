import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { classifyChanges, detectChanges, repositoryRoot } from "./ci-changes.mjs";
import { scopeOf } from "./check-ui-drift.mjs";

export function scriptTestFiles(root = repositoryRoot) {
  const walk = (directory) =>
    !existsSync(path.join(root, directory))
      ? []
      : readdirSync(path.join(root, directory), { withFileTypes: true }).flatMap((entry) => {
          const file = `${directory}/${entry.name}`;
          if (entry.isDirectory()) return walk(file);
          return /\.test\.(mjs|cjs)$/.test(entry.name) ? [file] : [];
        });
  return [...walk("scripts"), ...walk(".github/scripts")].sort();
}

export function localSourceIdentity(root = repositoryRoot) {
  const git = (...args) =>
    execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
  try {
    return {
      sourceSha: git("rev-parse", "HEAD").trim(),
      sourceDirty: Boolean(git("status", "--porcelain", "--untracked-files=normal").trim()),
    };
  } catch {
    return { sourceSha: null, sourceDirty: null };
  }
}

export function localOptions(args) {
  const options = { limit: 12, timeoutMs: 120000 };
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (["--run", "--scripts", "--full"].includes(argument)) options[argument.slice(2)] = true;
    else if (["--base", "--max-tests", "--timeout-ms", "--report"].includes(argument)) {
      const value = args[++index];
      if (!value || value.startsWith("--")) throw new Error(`Missing value for ${argument}`);
      if (argument === "--base" || argument === "--report") options[argument.slice(2)] = value;
      else {
        const number = Number(value);
        if (
          !Number.isSafeInteger(number) ||
          number < 1 ||
          number > (argument === "--max-tests" ? 100 : 600000)
        )
          throw new Error(`Invalid bounded value for ${argument}`);
        options[argument === "--max-tests" ? "limit" : "timeoutMs"] = number;
      }
    } else throw new Error(`Unknown option: ${argument}`);
  }
  return options;
}

export function localPlan({ decision, root = repositoryRoot, limit = 12, scripts = false }) {
  const node = (name, args) => ({ name, command: process.execPath, args });
  if (scripts)
    return {
      steps: [node("Script fixture tests", ["--test", ...scriptTestFiles(root)])],
      deferred: [
        "Product web/Host/browser/native/mobile tests and live acceptance are outside this script-only run",
      ],
    };
  const files = decision.files.filter((file) => existsSync(path.join(root, file)));
  const steps = [];
  // Windows caps a spawned command line near 32 KB; a broad dirty checkout exceeds it
  // (spawn ENAMETOOLONG). Split file-list arguments into bounded batches instead.
  const batched = (name, build, files, batchSize = 120) => {
    for (let index = 0; index < files.length; index += batchSize) {
      const batch = files.slice(index, index + batchSize);
      const label = files.length > batchSize ? `${name} (${index / batchSize + 1})` : name;
      steps.push(node(label, build(batch)));
    }
  };
  const tool = (name, args) => {
    const manifest = JSON.parse(
      readFileSync(path.join(root, "node_modules", name, "package.json"), "utf8"),
    );
    const bin =
      typeof manifest.bin === "string" ? manifest.bin : manifest.bin?.[name.split("/").at(-1)];
    if (!bin)
      throw new Error(
        `Installed ${name} executable is unavailable; this runner never installs dependencies`,
      );
    return [path.join(root, "node_modules", name, bin), ...args];
  };
  const supported = files.filter((file) =>
    /\.(?:[cm]?[jt]sx?|jsonc?|ya?ml|md|css|html|toml)$/.test(file),
  );
  const code = files.filter((file) => /\.[cm]?[jt]sx?$/.test(file));
  batched("Changed-file formatting", (batch) => tool("oxfmt", ["--check", ...batch]), supported);
  batched("Changed-file lint", (batch) => tool("oxlint", [...batch]), code);
  const ui = files.filter((file) => scopeOf(file));
  batched(
    "Changed-file UI drift ratchet",
    (batch) => [path.join(root, "scripts/checks/check-ui-drift.mjs"), "--files", ...batch],
    ui,
  );
  const invariants = files.filter((file) =>
    /^(?:src|host|packages|src-tauri\/src)\/.*\.(?:[cm]?[jt]sx?|rs)$/.test(file),
  );
  batched(
    "Changed-file code invariants ratchet",
    (batch) => [path.join(root, "scripts/checks/check-invariants.mjs"), "--files", ...batch],
    invariants,
  );
  batched(
    "Changed-file code structure ratchet",
    (batch) => [path.join(root, "scripts/checks/check-code-structure.mjs"), "--files", ...batch],
    invariants,
  );
  const hooks = code.filter((file) => file.startsWith("src/"));
  batched(
    "Changed React hook contracts",
    (batch) => tool("oxlint", ["--config", ".oxlint-hooks.json", ...batch]),
    hooks,
  );

  const tests = new Set();
  for (const file of files) {
    if (/\.test\.(?:[cm]?js|tsx?)$/.test(file)) tests.add(file);
    if (!/\.(?:[cm]?[jt]sx?)$/.test(file) || /\.test\./.test(file)) continue;
    const directory = path.posix.dirname(file);
    const prefix = path.posix.basename(file).replace(/\.[^.]+$/, "") + ".";
    for (const candidate of readdirSync(path.join(root, directory))) {
      if (candidate.startsWith(prefix) && /\.test\.(?:[cm]?js|tsx?)$/.test(candidate))
        tests.add(`${directory}/${candidate}`.replace(/^\.\//, ""));
    }
  }
  const selected = [...tests].sort().slice(0, limit);
  const web = selected.filter((file) => file.startsWith("src/") && file.endsWith(".test.ts"));
  const host = selected.filter((file) => file.startsWith("host/") && file.endsWith(".test.ts"));
  const scriptsTests = selected.filter((file) => /\.test\.(?:mjs|cjs)$/.test(file));
  if (web.length)
    steps.push(
      node(
        "Adjacent web behavior tests",
        tool("vitest", ["run", "--config", "vitest.config.ts", ...web]),
      ),
    );
  if (host.length)
    steps.push(
      node(
        "Adjacent Host tests (no implicit prebuild)",
        tool("vitest", ["run", "--config", "host/vitest.config.ts", ...host]),
      ),
    );
  if (scriptsTests.length)
    steps.push(node("Adjacent script fixture tests", ["--test", ...scriptsTests]));
  const deferred = [
    `Full CI gates: ${
      Object.entries(decision.gates)
        .filter(([, enabled]) => enabled)
        .map(([gate]) => gate)
        .join(", ") || "none selected"
    }`,
    "Full TypeScript suites, production builds, browser fixtures, three-OS checks, mobile and installed/live acceptance are not executed by this bounded runner",
    "Adjacent-file selection is a local iteration aid; the shared classifier keeps broader CI dependents selected",
  ];
  if (tests.size > selected.length)
    deferred.push(
      `${tests.size - selected.length} adjacent test files exceed --max-tests=${limit}; CI still owns complete suites`,
    );
  return { steps, deferred, selectedTests: selected };
}

async function execute(step, { root, timeoutMs }) {
  const started = Date.now();
  let timedOut = false;
  const child = spawn(step.command, step.args, {
    cwd: root,
    stdio: "inherit",
    windowsHide: true,
    detached: process.platform !== "win32",
  });
  const timer = setTimeout(() => {
    timedOut = true;
    if (!child.pid) return;
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
  const exitCode = await new Promise((resolve) => {
    child.once("error", () => resolve(1));
    child.once("exit", (code) => resolve(code ?? 1));
  });
  clearTimeout(timer);
  return { name: step.name, exitCode, timedOut, durationMs: Date.now() - started };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const options = localOptions(process.argv.slice(2));
  const identity = localSourceIdentity();
  const decision = options.scripts ? classifyChanges([]) : detectChanges(options);
  const plan = localPlan({ ...options, decision });
  console.log(
    JSON.stringify(
      { mode: options.run ? "bounded execution" : "plan only", ...identity, decision, ...plan },
      null,
      2,
    ),
  );
  if (options.run) {
    const results = [];
    for (const step of plan.steps)
      results.push(await execute(step, { root: repositoryRoot, timeoutMs: options.timeoutMs }));
    const report = {
      schemaVersion: 1,
      ...identity,
      results,
      deferred: plan.deferred,
      success: results.every((result) => result.exitCode === 0 && !result.timedOut),
    };
    if (options.report) {
      const file = path.resolve(repositoryRoot, options.report);
      const relative = path.relative(path.join(repositoryRoot, "temp"), file);
      if (relative.startsWith("..") || path.isAbsolute(relative))
        throw new Error("Local reports must be under temp/");
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`);
    }
    console.log(JSON.stringify(report, null, 2));
    if (!report.success) process.exitCode = 1;
  }
}
