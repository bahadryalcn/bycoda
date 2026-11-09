import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { constants } from "node:fs";

// Embedded so a bundled Host never depends on a source-checkout JSON path.
// The adjacent vendor source.json is checked for exact equality in tests.
export const AGENT_DESKTOP_SOURCE = Object.freeze({
  repository: "https://github.com/vercel-labs/agent-desktop.git",
  sourceRef: "9eb9b296192fcb70bda25e918cd6dd66abfa3d0d",
  version: "1.0.2",
  protocol: "2.5",
  rustToolchain: "1.89.0",
  cargoLockSha256: "3be8a5fdfc899e326249e61c96ca9756bc3d4078540e316f0e011aba6d9c40d7",
  licenseSha256: "cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30",
  license: "Apache-2.0",
});
const targets = {
  "win32-x64": { target: "x86_64-pc-windows-msvc", binary: "agent-desktop.exe", helpers: [] },
  "win32-arm64": { target: "aarch64-pc-windows-msvc", binary: "agent-desktop.exe", helpers: [] },
  "darwin-x64": {
    target: "x86_64-apple-darwin",
    binary: "agent-desktop",
    helpers: ["agent-desktop-macos-helper"],
  },
  "darwin-arm64": {
    target: "aarch64-apple-darwin",
    binary: "agent-desktop",
    helpers: ["agent-desktop-macos-helper"],
  },
  "linux-x64": {
    target: "x86_64-unknown-linux-gnu",
    binary: "agent-desktop",
    helpers: ["agent-desktop-linux-clipboard-owner"],
  },
  "linux-arm64": {
    target: "aarch64-unknown-linux-gnu",
    binary: "agent-desktop",
    helpers: ["agent-desktop-linux-clipboard-owner"],
  },
};
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function contained(parent, child) {
  const r = relative(parent, child);
  if (r.startsWith("..") || isAbsolute(r))
    throw new Error("Helper output escaped its cache directory.");
  return child;
}
function scope(options = {}) {
  const platform = options.platform ?? process.platform,
    arch = options.arch ?? process.arch;
  const target = targets[`${platform}-${arch}`];
  if (!target) throw new Error("No supported native desktop helper target for this platform.");
  const cacheRoot = resolve(options.cacheRoot ?? join(homedir(), ".bycoda-build", "helpers"));
  return {
    platform,
    arch,
    ...target,
    cacheRoot,
    bundleDir: join(cacheRoot, "agent-desktop", AGENT_DESKTOP_SOURCE.sourceRef, target.target),
  };
}
export function desktopHelperPlan(options = {}) {
  const plan = scope(options);
  return {
    ...plan,
    source: { ...AGENT_DESKTOP_SOURCE },
    files: [plan.binary, ...plan.helpers, "LICENSE"],
    prerequisites: [
      "Git",
      `Rust ${AGENT_DESKTOP_SOURCE.rustToolchain}`,
      plan.platform === "win32"
        ? "MSVC build tools"
        : plan.platform === "darwin"
          ? "Xcode command line tools"
          : "C linker",
    ],
    configurationChanged: false,
  };
}
export class DesktopHelperInterruptedError extends Error {
  code = "DESKTOP_HELPER_BUILD_INTERRUPTED";
  constructor(childPid) {
    super(
      "Desktop helper preparation was interrupted. Its direct child closed, but descendant compiler termination is unverified; inspect the retained build workspace/lock before retrying.",
    );
    this.name = "DesktopHelperInterruptedError";
    this.childPid = childPid;
  }
}
export async function runHelperProcess(binary, args, options = {}) {
  options.signal?.throwIfAborted();
  return new Promise((done, fail) => {
    const child = spawn(binary, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      windowsHide: true,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      signal: options.signal,
    });
    let stdout = "",
      stderr = "",
      overflow = false,
      timedOut = false,
      spawnError;
    const append = (kind, data) => {
      if (stdout.length + stderr.length + data.length > 1024 * 1024) {
        overflow = true;
        child.kill();
        return;
      }
      if (kind === "stdout") stdout += data;
      else stderr += data;
    };
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (data) => append("stdout", data));
    child.stderr.on("data", (data) => append("stderr", data));
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, options.timeoutMs ?? 120000);
    child.once("error", (error) => {
      spawnError = error;
    });
    // Abort emits 'error' before 'close'. Never release the preparation lease
    // on that early event or claim that a cargo process tree has fully retired.
    child.once("close", (code) => {
      clearTimeout(timeout);
      if (child.pid && (options.signal?.aborted || timedOut || overflow))
        return fail(new DesktopHelperInterruptedError(child.pid));
      if (spawnError) return fail(spawnError);
      if (code !== 0)
        return fail(
          new Error(
            `Helper preparation command failed (${binary}, exit ${code}): ${stderr.slice(-2000)}`,
          ),
        );
      done({ stdout, stderr, exitCode: code });
    });
  });
}
async function leaf(path, max = 32 * 1024 * 1024) {
  const entry = await lstat(path);
  if (!entry.isFile() || entry.isSymbolicLink() || entry.size > max)
    throw new Error("Helper package contains an invalid or oversized file.");
  return readFile(path);
}
async function verifyBundle(bundleDir, plan, spec = AGENT_DESKTOP_SOURCE) {
  const folder = await lstat(bundleDir);
  if (!folder.isDirectory() || folder.isSymbolicLink())
    throw new Error("Helper bundle must be a real directory.");
  const manifestPath = join(bundleDir, "manifest.json");
  const manifest = JSON.parse((await leaf(manifestPath, 32000)).toString("utf8"));
  if (
    manifest.schema !== 1 ||
    !same(manifest.source, spec) ||
    manifest.target !== plan.target ||
    manifest.platform !== plan.platform ||
    manifest.arch !== plan.arch ||
    manifest.binary !== plan.binary ||
    manifest.toolchain !== spec.rustToolchain ||
    typeof manifest.builtAt !== "string" ||
    !Array.isArray(manifest.files)
  )
    throw new Error("Helper package provenance does not match the pinned source and target.");
  const expected = [plan.binary, ...plan.helpers, "LICENSE"].sort();
  if (!same(manifest.files.map((file) => file.name).sort(), expected))
    throw new Error("Helper package file set does not match its platform.");
  for (const file of manifest.files) {
    if (
      typeof file.name !== "string" ||
      !expected.includes(file.name) ||
      !/^[a-f0-9]{64}$/.test(file.sha256) ||
      !Number.isSafeInteger(file.size) ||
      file.size < 1
    )
      throw new Error("Invalid helper package manifest entry.");
    const bytes = await leaf(join(bundleDir, file.name));
    if (bytes.length !== file.size || hash(bytes) !== file.sha256)
      throw new Error("Helper package checksum mismatch.");
    if (file.name === "LICENSE" && file.sha256 !== spec.licenseSha256)
      throw new Error("Helper license does not match the pinned upstream license.");
  }
  const binary = manifest.files.find((file) => file.name === plan.binary);
  return {
    manifestPath,
    binaryPath: join(bundleDir, plan.binary),
    binarySha256: binary.sha256,
    sourceRef: spec.sourceRef,
    protocol: spec.protocol,
    version: spec.version,
    target: plan.target,
    files: manifest.files,
    manifest,
  };
}
export async function readDesktopHelper(options = {}) {
  const plan = scope(options);
  return optionalBundle(plan, AGENT_DESKTOP_SOURCE);
}
/** Read-only discovery of a shipped sibling bundle; never builds or enables it. */
export async function readDesktopHelperBundle(bundleDir, options = {}) {
  const plan = { ...scope(options), bundleDir: resolve(bundleDir) };
  return optionalBundle(plan, AGENT_DESKTOP_SOURCE);
}
/** Copy only pinned, checksum-verified files into a new package subdirectory. */
export async function copyDesktopHelperBundle(bundleDir, destination, options = {}) {
  const source = await verifyBundle(resolve(bundleDir), scope(options));
  await mkdir(destination, { recursive: false });
  for (const file of source.files)
    await copyFile(
      join(bundleDir, file.name),
      join(destination, file.name),
      constants.COPYFILE_EXCL,
    );
  await copyFile(source.manifestPath, join(destination, "manifest.json"), constants.COPYFILE_EXCL);
  const copied = await verifyBundle(destination, scope(options));
  if (!same(copied.manifest, source.manifest))
    throw new Error("Desktop helper changed while packaging.");
  return copied;
}
async function lease(plan, work) {
  await mkdir(dirname(plan.bundleDir), { recursive: true });
  const parent = await realpath(dirname(plan.bundleDir));
  const cache = await realpath(plan.cacheRoot);
  contained(cache, parent);
  const lockPath = join(parent, `${plan.target}.prepare.lock`);
  let lock;
  try {
    lock = await open(lockPath, "wx");
  } catch (error) {
    if (error?.code === "EEXIST")
      throw new Error(
        "Desktop helper preparation is already running or has an unresolved lock. Inspect its build workspace before retrying.",
      );
    throw error;
  }
  const token = randomUUID(),
    identity = await lock.stat();
  let interrupted = false;
  try {
    await lock.writeFile(
      JSON.stringify({ pid: process.pid, token, startedAt: new Date().toISOString() }),
    );
    return await work(parent);
  } catch (error) {
    interrupted =
      error?.code === "DESKTOP_HELPER_BUILD_INTERRUPTED" || error?.name === "AbortError";
    if (interrupted) {
      await lock.truncate(0);
      await lock.write(
        JSON.stringify({
          pid: process.pid,
          token,
          status: "interrupted-unknown",
          childPid: error?.childPid ?? null,
          at: new Date().toISOString(),
        }),
        0,
        "utf8",
      );
    }
    throw error;
  } finally {
    await lock.close();
    if (!interrupted) {
      const current = await lstat(lockPath);
      const owner = JSON.parse(await readFile(lockPath, "utf8"));
      if (
        current.dev === identity.dev &&
        current.ino === identity.ino &&
        owner.pid === process.pid &&
        owner.token === token
      )
        await unlink(lockPath);
    }
  }
}
async function optionalBundle(plan, spec) {
  try {
    await lstat(plan.bundleDir);
  } catch (error) {
    if (error?.code === "ENOENT") return undefined;
    throw error;
  }
  return verifyBundle(plan.bundleDir, plan, spec);
}
async function probe(binary, run, options, spec) {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !/^AGENT_DESKTOP_/i.test(key)),
  );
  const result = await run(binary, ["version"], { signal: options.signal, timeoutMs: 10000, env });
  const envelope = JSON.parse(result.stdout);
  if (
    result.exitCode !== 0 ||
    envelope.ok !== true ||
    envelope.command !== "version" ||
    envelope.version !== spec.protocol ||
    envelope.data?.version !== spec.version
  )
    throw new Error("Prepared desktop helper reports an incompatible native version/protocol.");
}
/** Explicit artifact preparation only. It never edits Host configuration, PATH,
 * installed app files, permissions, desktop state, or the user's default toolchain.
 * deps.source exists for offline fixture tests; production always uses the pin. */
export async function prepareDesktopHelper(options = {}, deps = {}) {
  const plan = scope(options),
    spec = deps.source ?? AGENT_DESKTOP_SOURCE,
    run = deps.run ?? runHelperProcess;
  if (plan.platform !== process.platform || plan.arch !== process.arch)
    throw new Error("Build the desktop helper on its native target machine.");
  options.signal?.throwIfAborted();
  return lease(plan, async (parent) => {
    const ready = await optionalBundle(plan, spec);
    if (ready) return ready;
    // Keep Git/Cargo paths short on Windows; the immutable destination retains
    // the full commit/target while the build workspace needs no duplicated IDs.
    const cache = await realpath(plan.cacheRoot),
      workRoot = join(cache, ".work");
    await mkdir(workRoot, { recursive: true });
    contained(cache, await realpath(workRoot));
    const workspace = contained(cache, join(workRoot, randomUUID().slice(0, 12))),
      sourceDir = join(workspace, "source"),
      bundle = join(workspace, "bundle");
    await mkdir(sourceDir, { recursive: true });
    await mkdir(bundle);
    const progress = (stage) => options.onProgress?.({ stage, workspace, target: plan.target });
    const execute = (binary, args, cwd = sourceDir, timeoutMs = 120000) =>
      run(binary, args, {
        cwd,
        signal: options.signal,
        timeoutMs,
        ...(binary === "cargo"
          ? { env: { ...process.env, CARGO_TARGET_DIR: join(sourceDir, "target") } }
          : {}),
      });
    await writeFile(
      join(workspace, "README.md"),
      "Isolated pinned agent-desktop build workspace. Preserve failed work and compiler caches for diagnosis/reuse. No application configuration is changed.\n",
    );
    progress("acquiring");
    await execute("git", ["init", "--quiet"]);
    await execute("git", [
      "-c",
      "core.autocrlf=false",
      "-c",
      "core.longpaths=true",
      "fetch",
      "--quiet",
      "--depth=1",
      spec.repository,
      spec.sourceRef,
    ]);
    await execute("git", [
      "-c",
      "core.autocrlf=false",
      "-c",
      "core.longpaths=true",
      "checkout",
      "--quiet",
      "--detach",
      "FETCH_HEAD",
    ]);
    const commit = (await execute("git", ["rev-parse", "HEAD"])).stdout.trim();
    if (commit !== spec.sourceRef)
      throw new Error("Fetched helper source does not match the immutable commit.");
    for (const [name, expected] of [
      ["Cargo.lock", spec.cargoLockSha256],
      ["LICENSE", spec.licenseSha256],
    ])
      if (hash(await leaf(join(sourceDir, name))) !== expected)
        throw new Error(`Pinned helper ${name} checksum mismatch.`);
    const toolchain = (await leaf(join(sourceDir, "rust-toolchain.toml"), 4000)).toString("utf8");
    if (
      !new RegExp(`channel\\s*=\\s*"${spec.rustToolchain.replaceAll(".", "\\.")}"`).test(toolchain)
    )
      throw new Error("Pinned helper Rust toolchain changed.");
    progress("building");
    // Provision only the build components for the immutable toolchain. Relying
    // on the caller's rustup default profile can download unrelated docs/tools.
    await execute(
      "rustup",
      ["toolchain", "install", spec.rustToolchain, "--profile", "minimal", "--no-self-update"],
      sourceDir,
      1200000,
    );
    const cargoArgs = [
      `+${spec.rustToolchain}`,
      "build",
      "--locked",
      "--release",
      "--target",
      plan.target,
    ];
    await execute("cargo", [...cargoArgs, "-p", "agent-desktop"], sourceDir, 1200000);
    if (plan.platform === "darwin")
      await execute(
        "cargo",
        [...cargoArgs, "-p", "agent-desktop-macos", "--bin", "agent-desktop-macos-helper"],
        sourceDir,
        1200000,
      );
    if (plan.platform === "linux")
      await execute(
        "cargo",
        [...cargoArgs, "-p", "agent-desktop-linux", "--bins"],
        sourceDir,
        1200000,
      );
    await execute("git", ["diff", "--exit-code", "HEAD", "--"]);
    const compiler = (
      await execute("rustc", [`+${spec.rustToolchain}`, "--version"])
    ).stdout.trim();
    if (!compiler.startsWith(`rustc ${spec.rustToolchain} `))
      throw new Error("The helper compiler did not match its pinned Rust toolchain.");
    progress("verifying");
    for (const name of [plan.binary, ...plan.helpers]) {
      await leaf(join(sourceDir, "target", plan.target, "release", name));
      await copyFile(join(sourceDir, "target", plan.target, "release", name), join(bundle, name));
      if (plan.platform !== "win32") await chmod(join(bundle, name), 0o755);
    }
    await copyFile(join(sourceDir, "LICENSE"), join(bundle, "LICENSE"));
    await probe(join(bundle, plan.binary), run, options, spec);
    const files = [];
    for (const name of [plan.binary, ...plan.helpers, "LICENSE"]) {
      const bytes = await leaf(join(bundle, name));
      files.push({ name, size: bytes.length, sha256: hash(bytes) });
    }
    const manifest = {
      schema: 1,
      source: { ...spec },
      platform: plan.platform,
      arch: plan.arch,
      target: plan.target,
      binary: plan.binary,
      toolchain: spec.rustToolchain,
      compiler,
      builtAt: new Date().toISOString(),
      files,
    };
    await writeFile(join(bundle, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, {
      flag: "wx",
    });
    await verifyBundle(bundle, plan, spec);
    options.signal?.throwIfAborted();
    await rename(bundle, contained(parent, join(parent, plan.target)));
    const result = await verifyBundle(plan.bundleDir, plan, spec);
    progress("ready");
    return result;
  });
}
/** Import a prepared/shipped artifact without requiring Git or Rust on the owner PC. */
export async function importDesktopHelper(options) {
  if (!options?.bundleDir) throw new Error("A prepared helper bundle is required.");
  const plan = scope(options);
  options.signal?.throwIfAborted();
  return lease(plan, async (parent) => {
    const source = await verifyBundle(resolve(options.bundleDir), plan),
      ready = await optionalBundle(plan, AGENT_DESKTOP_SOURCE);
    if (ready) {
      if (ready.binarySha256 !== source.binarySha256)
        throw new Error("A different helper build already occupies this immutable cache target.");
      return ready;
    }
    const staging = contained(parent, join(parent, `.import-${plan.target}-${randomUUID()}`));
    await mkdir(staging);
    for (const file of source.files) {
      await copyFile(join(dirname(source.manifestPath), file.name), join(staging, file.name));
      if (plan.platform !== "win32" && file.name !== "LICENSE")
        await chmod(join(staging, file.name), 0o755);
    }
    await copyFile(source.manifestPath, join(staging, "manifest.json"));
    await verifyBundle(staging, plan);
    options.signal?.throwIfAborted();
    await rename(staging, contained(parent, join(parent, plan.target)));
    return verifyBundle(plan.bundleDir, plan);
  });
}
async function main(args) {
  let mode = "plan",
    bundleDir,
    cacheRoot;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (["--plan", "--status", "--prepare"].includes(arg)) {
      if (mode !== "plan") throw new Error("Choose one helper setup operation.");
      mode = arg.slice(2);
    } else if (arg === "--import") {
      if (mode !== "plan") throw new Error("Choose one helper setup operation.");
      mode = "import";
      bundleDir = args[++i];
      if (!bundleDir) throw new Error("--import requires a prepared bundle directory.");
    } else if (arg === "--cache-root") {
      cacheRoot = args[++i];
      if (!cacheRoot) throw new Error("--cache-root requires a directory.");
    } else
      throw new Error(
        "Usage: node scripts/setup/agent-desktop.mjs [--plan|--status|--prepare|--import BUNDLE] [--cache-root DIRECTORY]",
      );
  }
  const options = cacheRoot ? { cacheRoot } : {};
  const result =
    mode === "prepare"
      ? await prepareDesktopHelper(options)
      : mode === "import"
        ? await importDesktopHelper({ ...options, bundleDir })
        : mode === "status"
          ? await readDesktopHelper(options)
          : desktopHelperPlan(options);
  process.stdout.write(`${JSON.stringify(result ?? { prepared: false })}\n`);
}
if (
  typeof import.meta.url === "string" &&
  process.argv[1] &&
  basename(process.argv[1]) === "agent-desktop.mjs" &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : "Desktop helper preparation failed."}\n`,
    );
    process.exitCode = 1;
  });
