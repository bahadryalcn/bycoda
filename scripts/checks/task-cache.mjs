/** Opt-in deterministic output cache. It never represents test/live acceptance. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  appendFileSync,
  readdirSync,
  realpathSync,
} from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
export const taskContracts = {
  "repository-inventory": {
    version: 1,
    output: "repository-inventory.json",
    limit: 16 * 1024 * 1024,
    evidence: "static-source-inventory",
  },
};
export function taskInputKey(identity) {
  assert(
    taskContracts[identity?.task]?.version === identity.contractVersion &&
      identity.schemaVersion === 1 &&
      [identity.platform, identity.arch, identity.nodeVersion, identity.typescriptVersion].every(
        (value) => typeof value === "string" && value.length > 0 && value.length < 100,
      ) &&
      [identity.compilerHash, identity.inputFingerprint, identity.configurationHash].every(
        (value) => /^[a-f0-9]{64}$/.test(value),
      ),
    "Incomplete task identity",
  );
  return hash(JSON.stringify(identity));
}
export function fingerprintTaskFiles(root, tracked) {
  const canonicalRoot = realpathSync(root),
    paths = new Set(tracked),
    visited = new Set(),
    links = [];
  const walk = (directory) => {
    if (!existsSync(directory)) return;
    const actual = realpathSync(directory),
      relative = path.relative(canonicalRoot, actual);
    assert(
      !relative.startsWith("..") && !path.isAbsolute(relative),
      "Task inputs may not escape the checkout",
    );
    if (visited.has(actual)) return;
    visited.add(actual);
    for (const entry of readdirSync(actual, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const file = path.join(actual, entry.name),
        stat = lstatSync(file);
      if (stat.isSymbolicLink()) {
        const resolved = realpathSync(file),
          local = path.relative(canonicalRoot, resolved);
        assert(
          !local.startsWith("..") && !path.isAbsolute(local),
          "External task dependencies cannot be cached",
        );
        links.push([
          path.relative(canonicalRoot, file).replaceAll("\\", "/"),
          local.replaceAll("\\", "/"),
        ]);
        if (lstatSync(resolved).isDirectory()) walk(resolved);
        else paths.add(local.replaceAll("\\", "/"));
      } else if (stat.isDirectory()) walk(file);
      else {
        assert(stat.isFile(), "Nonregular task input");
        paths.add(path.relative(canonicalRoot, file).replaceAll("\\", "/"));
      }
    }
  };
  // Actual resolver inputs matter too: ignored/generated source and installed
  // package metadata/declarations cannot silently borrow a tracked-only key.
  for (const family of ["src", "host", "apps", "packages", "src-tauri", "node_modules"])
    walk(path.join(root, family));
  assert(paths.size > 0 && paths.size <= 250000, "Complete task input set exceeds bound");
  const input = createHash("sha256");
  let bytes = 0;
  input.update(JSON.stringify(links.sort((a, b) => a[0].localeCompare(b[0])))).update("\0");
  for (const file of [...paths].sort()) {
    const actual = path.join(root, file),
      stat = lstatSync(actual);
    assert(stat.isFile(), "Symlink/gitlink tracked inputs are unsupported");
    bytes += stat.size;
    assert(bytes <= 4 * 1024 * 1024 * 1024, "Complete task inputs exceed byte bound");
    input
      .update(file)
      .update("\0")
      .update(hash(readFileSync(actual)))
      .update("\0");
  }
  return { inputFingerprint: input.digest("hex"), inputFiles: paths.size, inputBytes: bytes };
}
export function cachePolicy({
  ci = false,
  event,
  ref,
  repository,
  headRepository,
  localOwner = false,
} = {}) {
  if (!ci) return { read: true, write: localOwner, writer: "explicit-local-owner" };
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository ?? ""))
    return { read: false, write: false, writer: "invalid-ci-context" };
  if (event === "pull_request" && headRepository !== repository)
    return { read: false, write: false, writer: "fork-disabled" };
  return {
    read: true,
    write: ref === "refs/heads/main" && ["push", "workflow_dispatch"].includes(event),
    writer: `${repository}:${ref}`,
  };
}
export function taskInputs({
  root,
  task,
  platform = process.platform,
  arch = process.arch,
  nodeVersion = process.versions.node,
}) {
  const started = performance.now();
  const contract = taskContracts[task];
  assert(contract, "Task has no reviewed deterministic cache contract");
  const git = (...args) =>
    execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 16 * 1024 * 1024,
    });
  assert.equal(
    git("status", "--porcelain", "--untracked-files=all").trim(),
    "",
    "Task cache requires clean complete inputs",
  );
  const tracked = git("ls-files", "-z").split("\0").filter(Boolean).sort();
  assert(tracked.length > 0 && tracked.length <= 50000, "Invalid complete input set");
  for (const file of tracked) {
    assert(!file.startsWith("/") && !file.split("/").includes(".."), "Unsafe tracked input");
  }
  assert(
    !process.env.NODE_OPTIONS && !process.env.NODE_PATH,
    "Unreviewed Node loaders/options cannot reuse task outputs",
  );
  const fingerprint = fingerprintTaskFiles(root, tracked);
  const tsRoot = path.join(root, "node_modules/@typescript/typescript6");
  const tsManifest = JSON.parse(readFileSync(path.join(tsRoot, "package.json"), "utf8"));
  const compilerHash = hash(readFileSync(path.join(tsRoot, "lib/typescript.js")));
  const identity = {
    schemaVersion: 1,
    task,
    contractVersion: contract.version,
    platform,
    arch,
    nodeVersion,
    typescriptVersion: tsManifest.version,
    compilerHash,
    inputFingerprint: fingerprint.inputFingerprint,
    configurationHash: hash(
      JSON.stringify({
        LANG: process.env.LANG ?? "",
        LC_ALL: process.env.LC_ALL ?? "",
        TZ: process.env.TZ ?? "",
      }),
    ),
  };
  assert.equal(
    git("status", "--porcelain", "--untracked-files=all").trim(),
    "",
    "Inputs changed during cache identity capture",
  );
  return {
    identity,
    key: taskInputKey(identity),
    ...fingerprint,
    inputVerificationMs: performance.now() - started,
    sourceSha: git("rev-parse", "HEAD").trim(),
  };
}
export function restoreOutput({ store, destination, input, policy }) {
  const started = performance.now();
  if (!policy.read)
    return { hit: false, disabled: true, restoreMs: performance.now() - started, bytesVerified: 0 };
  assert.equal(input.key, taskInputKey(input.identity), "Task identity/key differs");
  const folder = path.join(store, input.key),
    manifestFile = path.join(folder, "manifest.json");
  if (!existsSync(manifestFile))
    return { hit: false, restoreMs: performance.now() - started, bytesVerified: 0 };
  assert.equal(
    realpathSync(folder),
    path.resolve(folder),
    "Cache entry may not traverse a symlink",
  );
  const stat = lstatSync(manifestFile);
  assert(stat.isFile() && stat.size <= 64 * 1024, "Unsafe cache manifest");
  const manifest = JSON.parse(readFileSync(manifestFile, "utf8")),
    contract = taskContracts[input.identity.task];
  assert(
    manifest.schemaVersion === 1 &&
      manifest.key === input.key &&
      JSON.stringify(manifest.identity) === JSON.stringify(input.identity) &&
      manifest.writer?.trusted === true &&
      manifest.output?.path === contract.output &&
      manifest.evidence === contract.evidence,
    "Foreign or untrusted cached output",
  );
  const file = path.join(folder, contract.output),
    size = lstatSync(file);
  assert(
    size.isFile() &&
      size.size > 0 &&
      size.size <= contract.limit &&
      size.size === manifest.output.bytes &&
      hash(readFileSync(file)) === manifest.output.sha256,
    "Cached content hash differs",
  );
  mkdirSync(destination, { recursive: true });
  copyFileSync(file, path.join(destination, contract.output));
  return {
    hit: true,
    restoreMs: performance.now() - started,
    bytesVerified: size.size,
    key: input.key,
    evidence: contract.evidence,
    liveAcceptance: false,
  };
}
export function saveOutput({ store, output, input, policy }) {
  assert(policy.write, "Only explicit local owners or trusted main jobs may write task outputs");
  const contract = taskContracts[input.identity.task];
  assert(contract && input.key === taskInputKey(input.identity), "Invalid task identity");
  const file = path.join(output, contract.output),
    stat = lstatSync(file);
  assert(stat.isFile() && stat.size > 0 && stat.size <= contract.limit, "Unsafe task output");
  const folder = path.join(store, input.key);
  assert(!existsSync(path.join(folder, "manifest.json")), "Task cache entries are immutable");
  mkdirSync(folder, { recursive: true });
  const bytes = readFileSync(file);
  writeFileSync(path.join(folder, contract.output), bytes, { flag: "wx" });
  const manifest = {
    schemaVersion: 1,
    key: input.key,
    identity: input.identity,
    evidence: contract.evidence,
    writer: { trusted: true, identity: policy.writer },
    output: { path: contract.output, bytes: bytes.length, sha256: hash(bytes) },
  };
  writeFileSync(path.join(folder, "manifest.json"), JSON.stringify(manifest), { flag: "wx" });
  return manifest;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [command, ...args] = process.argv.slice(2),
    options = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--allow-local-write") options.localOwner = true;
    else {
      assert(
        args[i].startsWith("--") && args[i + 1] && !args[i + 1].startsWith("--"),
        "Expected option value",
      );
      options[args[i].slice(2)] = args[++i];
    }
  }
  const root = process.cwd(),
    task = options.task ?? "repository-inventory",
    input = taskInputs({ root, task });
  if (command === "key") {
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `key=${input.key}\n`);
    console.log(JSON.stringify(input));
  } else if (command === "run") {
    const policy = cachePolicy({
      ci: process.env.GITHUB_ACTIONS === "true",
      event: process.env.GITHUB_EVENT_NAME,
      ref: process.env.GITHUB_REF,
      repository: process.env.GITHUB_REPOSITORY,
      headRepository: process.env.CACHE_HEAD_REPOSITORY,
      localOwner: options.localOwner,
    });
    assert(policy.read, "Task output cache is disabled for this trust context");
    const store = path.resolve(options.store),
      output = path.resolve(options.output);
    const result = restoreOutput({ store, destination: output, input, policy });
    if (!result.hit) {
      const started = performance.now();
      const { inventoryRepository } = await import("./repository-graph.mjs");
      mkdirSync(output, { recursive: true });
      writeFileSync(
        path.join(output, taskContracts[task].output),
        JSON.stringify(inventoryRepository(root), null, 2),
      );
      result.executeMs = performance.now() - started;
    }
    const after = taskInputs({ root, task });
    assert.equal(after.key, input.key, "Inputs changed during cached task execution/restore");
    if (!result.hit && policy.write) saveOutput({ store, output, input, policy });
    const measurement = {
      ...result,
      key: input.key,
      sourceSha: input.sourceSha,
      inputFiles: input.inputFiles,
      inputBytes: input.inputBytes,
      inputVerificationMs: input.inputVerificationMs + after.inputVerificationMs,
      output: taskContracts[task].output,
      liveAcceptance: false,
    };
    writeFileSync(
      path.join(output, "cache-measurement.json"),
      `${JSON.stringify(measurement, null, 2)}\n`,
    );
    console.log(JSON.stringify(measurement));
  } else throw new Error("Expected key or run; cache is never enabled implicitly");
}
