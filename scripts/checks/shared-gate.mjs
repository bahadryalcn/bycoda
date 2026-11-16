/**
 * Runs a full local gate once per working-tree state for every session that shares the
 * checkout. Sessions asking for the same gate on the same tree reuse one result; other
 * requests queue behind a single lock, because concurrent full gates on one checkout
 * race each other and prove nothing. CI and nested calls run the command directly.
 *
 * Usage: node scripts/checks/shared-gate.mjs <name> -- <command...>
 * GATE_FORCE=1 ignores a stored result; GATE_TIMEOUT_MS and GATE_WAIT_MS bound the run
 * and the queue.
 */
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { repositoryRoot } from "./ci-changes.mjs";

const maxResultAgeMs = 24 * 60 * 60 * 1000;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Content hash of the whole working tree (tracked changes and unignored new files),
 * taken through a private index so the real index and others' staging stay untouched.
 */
export function workingTreeHash(root = repositoryRoot) {
  const git = (args, env = {}) =>
    execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      windowsHide: true,
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 120000,
      maxBuffer: 16 * 1024 * 1024,
      env: { ...process.env, ...env },
    }).trim();
  const realIndex = path.resolve(root, git(["rev-parse", "--git-path", "index"]));
  const privateIndex = `${realIndex}.gate-${process.pid}`;
  try {
    if (existsSync(realIndex)) copyFileSync(realIndex, privateIndex);
    git(["add", "--all"], { GIT_INDEX_FILE: privateIndex });
    return git(["write-tree"], { GIT_INDEX_FILE: privateIndex });
  } finally {
    rmSync(privateIndex, { force: true });
    rmSync(`${privateIndex}.lock`, { force: true });
  }
}

export function gateKey({
  name,
  command,
  tree,
  platform = process.platform,
  node = process.version,
}) {
  return createHash("sha256")
    .update(JSON.stringify({ name, command, tree, platform, node }))
    .digest("hex")
    .slice(0, 32);
}

function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

/** Takes the single gate lock, or returns the live holder. A dead holder is replaced. */
export function acquireLock(file, owner, { alive = processAlive } = {}) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      writeFileSync(file, JSON.stringify(owner), { flag: "wx" });
      return { acquired: true };
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
    let holder = null;
    try {
      holder = JSON.parse(readFileSync(file, "utf8"));
    } catch {
      /* The holder is mid-write or just released; decide below. */
    }
    if (holder && Number.isInteger(holder.pid) && alive(holder.pid))
      return { acquired: false, holder };
    // An unreadable lock gets a short grace period before it counts as abandoned.
    if (!holder && attempt < 2) continue;
    rmSync(file, { force: true });
  }
  return { acquired: false, holder: null };
}

export function readResult(directory, name, key, { now = Date.now() } = {}) {
  try {
    const result = JSON.parse(readFileSync(path.join(directory, `${name}-${key}.json`), "utf8"));
    return result.key === key && now - result.finishedAt <= maxResultAgeMs ? result : null;
  } catch {
    return null;
  }
}

function pruneResults(directory, now = Date.now()) {
  for (const entry of readdirSync(directory)) {
    if (!/\.(?:json|log)$/.test(entry)) continue;
    const file = path.join(directory, entry);
    try {
      if (now - statSync(file).mtimeMs > maxResultAgeMs) rmSync(file, { force: true });
    } catch {
      /* Another session pruned it first. */
    }
  }
}

const tail = (file, lines = 60) => {
  try {
    return readFileSync(file, "utf8").trimEnd().split(/\r?\n/).slice(-lines).join("\n");
  } catch {
    return "";
  }
};

/** Runs the gate command with a deadline, mirroring its output into the shared log. */
function runCommand(command, { root, logFile, timeoutMs, control = {} }) {
  return new Promise((resolve) => {
    const log = createWriteStream(logFile);
    // Package-manager shims are .cmd files on Windows, so the command needs a shell.
    const child = spawn(command.join(" "), {
      cwd: root,
      shell: true,
      windowsHide: true,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, BYCODA_GATE_ACTIVE: "1" },
    });
    child.stdout.on("data", (chunk) => (process.stdout.write(chunk), log.write(chunk)));
    child.stderr.on("data", (chunk) => (process.stderr.write(chunk), log.write(chunk)));
    let timedOut = false;
    const kill = () => {
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
    };
    control.kill = kill;
    const timer = setTimeout(() => {
      timedOut = true;
      kill();
    }, timeoutMs);
    const finish = (exitCode) => {
      clearTimeout(timer);
      log.end(() => resolve({ exitCode: timedOut ? 124 : exitCode, timedOut }));
    };
    child.once("error", (error) => {
      log.write(String(error.message));
      finish(1);
    });
    child.once("close", (code) => finish(code ?? 1));
  });
}

/**
 * Returns the gate's exit code. `treeHash` and `run` are injectable so the queueing and
 * reuse rules are testable without git or a real gate.
 */
export async function sharedGate({
  name,
  command,
  root = repositoryRoot,
  directory = path.join(root, "temp", "gate-cache"),
  force = false,
  timeoutMs = 60 * 60 * 1000,
  waitMs = 90 * 60 * 1000,
  pollMs = 2000,
  treeHash = workingTreeHash,
  run = runCommand,
  alive = processAlive,
  print = console.log,
}) {
  mkdirSync(directory, { recursive: true });
  pruneResults(directory);
  const lockFile = path.join(directory, "lock");
  const safeTree = () => {
    try {
      return treeHash(root);
    } catch {
      return null; // No fingerprint: still queue, but never share the result.
    }
  };
  const waitStarted = Date.now();
  for (;;) {
    const tree = safeTree();
    const key = tree && gateKey({ name, command, tree });
    const stored = key && !force ? readResult(directory, name, key) : null;
    if (stored) {
      const age = Math.round((Date.now() - stored.finishedAt) / 1000);
      print(
        `[gate ${name}] ${stored.exitCode === 0 ? "passed" : "FAILED"} on this exact working tree ${age}s ago (pid ${stored.pid}, ${Math.round(stored.durationMs / 1000)}s); reusing that run. GATE_FORCE=1 reruns it.`,
      );
      print(tail(path.join(directory, `${name}-${key}.log`), stored.exitCode === 0 ? 15 : 60));
      return stored.exitCode;
    }
    const owner = { pid: process.pid, name, key, startedAt: Date.now() };
    const lock = acquireLock(lockFile, owner, { alive });
    if (!lock.acquired) {
      const holder = lock.holder;
      print(
        holder
          ? `[gate ${name}] waiting: "${holder.name}" gate is running in pid ${holder.pid}${holder.key === key ? " on this same tree; its result will be reused" : ""}.`
          : `[gate ${name}] waiting for the gate lock.`,
      );
      // Wait on the lock file alone; the tree is fingerprinted again once it is free.
      while (existsSync(lockFile) && (!holder || alive(holder.pid))) {
        if (Date.now() - waitStarted > waitMs) {
          print(`[gate ${name}] gave up waiting for the gate lock after ${waitMs}ms.`);
          return 125;
        }
        await sleep(pollMs);
      }
      continue;
    }
    const logFile = path.join(directory, `${name}-${key ?? `unshared-${process.pid}`}.log`);
    const control = {};
    const release = () => {
      control.kill?.();
      rmSync(lockFile, { force: true });
    };
    const onSignal = () => {
      release();
      process.exit(130);
    };
    process.once("SIGINT", onSignal);
    process.once("SIGTERM", onSignal);
    try {
      const started = Date.now();
      const result = await run(command, { root, logFile, timeoutMs, control });
      control.kill = undefined;
      const durationMs = Date.now() - started;
      if (result.timedOut) print(`[gate ${name}] timed out after ${timeoutMs}ms.`);
      // Only a run whose inputs stayed still is evidence for other sessions.
      if (key && safeTree() === tree)
        writeFileSync(
          path.join(directory, `${name}-${key}.json`),
          `${JSON.stringify({ key, name, command, tree, exitCode: result.exitCode, durationMs, finishedAt: Date.now(), pid: process.pid })}\n`,
        );
      else
        print(
          `[gate ${name}] the working tree changed during the run, so this result is not shared with other sessions.`,
        );
      return result.exitCode;
    } finally {
      process.off("SIGINT", onSignal);
      process.off("SIGTERM", onSignal);
      release();
    }
  }
}

export function gateArguments(args) {
  const separator = args.indexOf("--");
  const [name, ...rest] = separator < 0 ? args : args.slice(0, separator);
  const command = separator < 0 ? [] : args.slice(separator + 1);
  if (!/^[a-z][a-z0-9-]*$/.test(name ?? "") || rest.length || !command.length)
    throw new Error("Usage: shared-gate.mjs <name> -- <command...>");
  return { name, command };
}

const boundedEnv = (name, fallback) => {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value < 1000 || value > 6 * 60 * 60 * 1000)
    throw new Error(`Invalid bounded value for ${name}`);
  return value;
};

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const { name, command } = gateArguments(process.argv.slice(2));
  const timeoutMs = boundedEnv("GATE_TIMEOUT_MS", 60 * 60 * 1000);
  if (process.env.CI || process.env.BYCODA_GATE_ACTIVE) {
    // Nothing to share on a CI runner, and a nested gate already holds the lock.
    const logFile = path.join(
      repositoryRoot,
      "temp",
      "gate-cache",
      `${name}-direct-${process.pid}.log`,
    );
    mkdirSync(path.dirname(logFile), { recursive: true });
    const result = await runCommand(command, { root: repositoryRoot, logFile, timeoutMs });
    rmSync(logFile, { force: true });
    process.exit(result.exitCode);
  }
  process.exit(
    await sharedGate({
      name,
      command,
      force: process.env.GATE_FORCE === "1",
      timeoutMs,
      waitMs: boundedEnv("GATE_WAIT_MS", 90 * 60 * 1000),
    }),
  );
}
