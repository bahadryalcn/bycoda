/** Frozen-source identity helpers. No install, service, or repository mutations. */
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile, mkdir, realpath, writeFile } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const git = async (root, args) => {
  const result = await exec("git", args, {
    cwd: root,
    windowsHide: true,
    timeout: 15000,
    maxBuffer: 8 * 1024 * 1024,
  });
  if (args[0] === "rev-parse" && !result.stdout.trim())
    throw new Error("Git identity is unavailable");
  return result.stdout;
};

/** Rebuild an allowlisted object; untrusted metadata cannot echo tokens or arbitrary fields. */
export function parseBuildIdentity(value) {
  if (!value || typeof value !== "object" || value.schemaVersion !== 1) return null;
  const fields = [
    "buildId",
    "version",
    "channel",
    "mode",
    "repositoryId",
    "branch",
    "head",
    "sourceFingerprint",
  ];
  if (
    fields.some((key) => typeof value[key] !== "string" || !value[key] || value[key].length > 1024)
  )
    return null;
  if (
    !Number.isFinite(value.capturedAt) ||
    !Array.isArray(value.dirtyPaths) ||
    !Array.isArray(value.includedSources)
  )
    return null;
  if (["web", "native", "host"].some((key) => typeof value.components?.[key] !== "string"))
    return null;
  if (
    value.dirtyPaths.some(
      (entry) => typeof entry?.path !== "string" || typeof entry.status !== "string",
    )
  )
    return null;
  if (
    value.includedSources.some(
      (entry) =>
        typeof entry?.repositoryId !== "string" ||
        typeof entry.sourceHead !== "string" ||
        (entry.deliveryCommit !== undefined && typeof entry.deliveryCommit !== "string"),
    )
  )
    return null;
  return {
    schemaVersion: 1,
    ...Object.fromEntries(fields.map((key) => [key, value[key]])),
    capturedAt: value.capturedAt,
    dirtyPaths: value.dirtyPaths.map(({ path, status }) => ({ path, status })),
    components: Object.fromEntries(
      ["web", "native", "host"].map((key) => [key, value.components[key]]),
    ),
    includedSources: value.includedSources.map(({ repositoryId, sourceHead, deliveryCommit }) => ({
      repositoryId,
      sourceHead,
      ...(deliveryCommit ? { deliveryCommit } : {}),
    })),
  };
}

export async function readBuildIdentity(path) {
  try {
    return parseBuildIdentity(JSON.parse(await readFile(path, "utf8")));
  } catch {
    return null;
  }
}

export async function sourceFiles(root) {
  let names = (
    await git(root, ["ls-files", "-z", "--cached", "--others", "--exclude-standard"])
  ).split("\0");
  const extra = (
    await git(root, [
      "rev-parse",
      "--path-format=absolute",
      "--git-path",
      "info/local-build-sources",
    ])
  ).trim();
  try {
    await readFile(extra);
    names.push(
      ...(
        await git(root, ["ls-files", "-z", "--others", "--ignored", `--exclude-from=${extra}`])
      ).split("\0"),
    );
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const selected = [...new Set(names)]
    .filter(
      (name) =>
        name &&
        !/^(?:\.scratch\/|build\/|\.git\/)/.test(name) &&
        (!name.startsWith("docs/") || name.startsWith("docs/guides/")) &&
        !name.split("/").includes("__pycache__") &&
        !name.endsWith(".pyc"),
    )
    .sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
  const files = new Map();
  // Bound open handles while allowing large checkouts to finish promptly.
  for (let offset = 0; offset < selected.length; offset += 48) {
    await Promise.all(
      selected.slice(offset, offset + 48).map(async (name) => {
        try {
          files.set(name, await readFile(join(root, name)));
        } catch (error) {
          if (!["ENOENT", "EISDIR"].includes(error.code)) throw error;
        }
      }),
    );
  }
  return files;
}

export function fingerprintFiles(files) {
  const hash = createHash("sha256");
  for (const [path, content] of [...files].sort(([a], [b]) =>
    Buffer.compare(Buffer.from(a), Buffer.from(b)),
  )) {
    hash.update(path).update("\0").update(createHash("sha256").update(content).digest());
  }
  return hash.digest("hex");
}

export async function sourceIdentity(sourceRoot) {
  const root = resolve(sourceRoot);
  const [common, branch, head, status, files] = await Promise.all([
    git(root, ["rev-parse", "--path-format=absolute", "--git-common-dir"]),
    git(root, ["rev-parse", "--abbrev-ref", "HEAD"]),
    git(root, ["rev-parse", "HEAD"]),
    git(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]),
    sourceFiles(root),
  ]);
  let canonical = (await realpath(common.trim())).replaceAll("\\", "/");
  if (process.platform === "win32") canonical = canonical.toLowerCase();
  const dirtyPaths = [];
  const entries = status.split("\0");
  for (let i = 0; i < entries.length; i++) {
    if (!entries[i]) continue;
    const code = entries[i].slice(0, 2);
    dirtyPaths.push({ path: entries[i].slice(3), status: code });
    if (/[RC]/.test(code) && entries[i + 1]) dirtyPaths.push({ path: entries[++i], status: code });
  }
  dirtyPaths.sort((a, b) =>
    a.path < b.path ? -1 : a.path > b.path ? 1 : a.status.localeCompare(b.status),
  );
  return {
    repositoryId: sha(canonical),
    branch: branch.trim(),
    head: head.trim(),
    sourceFingerprint: fingerprintFiles(files),
    dirtyPaths,
  };
}

/** Implements the BuildIdentityManifest capture boundary against already frozen bytes. */
export async function captureBuildIdentity(request) {
  const before = await sourceIdentity(request.sourceRoot);
  const names = await sourceFiles(request.sourceRoot);
  const frozen = new Map(
    await Promise.all(
      [...names.keys()].map(async (name) => [name, await readFile(join(request.frozenRoot, name))]),
    ),
  );
  const after = await sourceIdentity(request.sourceRoot);
  if (
    JSON.stringify(before) !== JSON.stringify(after) ||
    fingerprintFiles(frozen) !== before.sourceFingerprint
  )
    throw new Error("Source changed while capturing build identity");
  if (!/^[a-zA-Z0-9._-]+$/.test(request.buildId)) throw new Error("Invalid build id");
  const identity = {
    schemaVersion: 1,
    buildId: request.buildId,
    version: request.version,
    channel: request.channel,
    mode: request.mode,
    ...before,
    capturedAt: Date.now(),
    components: { web: request.buildId, native: request.buildId, host: request.buildId },
    includedSources: [{ repositoryId: before.repositoryId, sourceHead: before.head }],
  };
  const path = join(request.frozenRoot, "build/build-info.json");
  await mkdir(dirname(path), { recursive: true });
  try {
    await writeFile(path, JSON.stringify(identity, null, 2) + "\n", { flag: "wx" });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    const existing = await readBuildIdentity(path);
    if (
      !existing ||
      JSON.stringify({ ...existing, capturedAt: 0 }) !==
        JSON.stringify({ ...parseBuildIdentity(identity), capturedAt: 0 })
    )
      throw new Error("Frozen build manifest is immutable");
    return existing;
  }
  return identity;
}
