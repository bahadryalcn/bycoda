import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { constants, existsSync } from "node:fs";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  rmdir,
  unlink,
} from "node:fs/promises";
// oxlint-disable-next-line no-restricted-imports -- exclusive upstream asset staging uses wx; durable receipts and provider metadata use writeFileAtomic.
import { writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { delimiter, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { execFileAsync } from "../../src/shared/lib/processExecution.node";
import {
  officialSkillNpmArgs,
  SKILLS_CLI_PACKAGE,
} from "../../src/features/skills/model/skillInstallRecipe";
import {
  RECOMMENDED_SKILLS,
  type RecommendedSkill,
} from "../../src/features/skills/model/recommendedSkills";
import {
  SKILL_INSTALL_PROVIDERS,
  type SkillInstallRequest,
  type SkillInstallResult,
} from "../../src/features/skills/model/skillInstallTypes";
import { skillDisabled } from "../../src/integrations/harness/core/skillPolicy";
import { readSkillPolicy } from "./skill-policy";
import { readStateFile, writeFileAtomic } from "../storage/atomic-write";

const MAX_FILES = 256;
const MAX_FILE_BYTES = 4 * 1024 * 1024;
const MAX_TOTAL_BYTES = 32 * 1024 * 1024;
const MARKER = ".bycoda-install.json";
const active = new Map<
  string,
  { request: SkillInstallRequest; promise: Promise<SkillInstallResult> }
>();
type InstallMarker = {
  schemaVersion: 1;
  provider: string;
  skillId: string;
  repository: string;
  commit: string;
  requestId: string;
  installer?: string;
  files: Record<string, string>;
};
type Receipt = { request: SkillInstallRequest; result: SkillInstallResult; destination: string };
type InstallerOptions = {
  cwd: string;
  env: NodeJS.ProcessEnv;
  windowsHide: true;
  shell: false;
  timeout: number;
  maxBuffer: number;
};
type InstallerCommand = (file: string, args: string[], options: InstallerOptions) => Promise<void>;
type Dependencies = {
  home?: string;
  fetch?: typeof fetch;
  catalog?: readonly RecommendedSkill[];
  npmCliPath?: string;
  command?: InstallerCommand;
};
const hash = (data: Uint8Array | string) => createHash("sha256").update(data).digest("hex");
const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === "ENOENT";

/** Own the npm/CLI/Git process tree, so timeout and output limits stop descendants too. */
export const runSkillInstallerCommand: InstallerCommand = (file, args, options) =>
  new Promise((resolveCommand, reject) => {
    const { timeout, maxBuffer, ...spawnOptions } = options;
    const windows = process.platform === "win32";
    const child = spawn(file, args, {
      ...spawnOptions,
      detached: !windows,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let settled = false;
    let stopping = false;
    let bytes = 0;
    let failure: Error | undefined;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolveCommand();
    };
    const stop = () => {
      if (stopping || settled) return;
      stopping = true;
      const terminate = async () => {
        if (!child.pid) return;
        if (windows)
          await execFileAsync(
            join(process.env.SystemRoot ?? "C:\\Windows", "System32", "taskkill.exe"),
            ["/PID", String(child.pid), "/T", "/F"],
            { windowsHide: true, shell: false, timeout: 10_000, maxBuffer: 16 * 1024 },
          );
        else {
          try {
            process.kill(-child.pid, "SIGKILL");
          } catch {
            child.kill("SIGKILL");
          }
        }
      };
      terminate()
        .catch(() => {
          child.kill("SIGKILL");
        })
        .finally(() => {
          child.stdout.destroy();
          child.stderr.destroy();
          child.unref();
          finish(failure);
        })
        .catch((error: unknown) =>
          finish(
            error instanceof Error ? error : new Error("Could not stop the public installer."),
          ),
        );
    };
    const timer = setTimeout(() => {
      failure = Object.assign(new Error("Public installer timed out."), { killed: true });
      stop();
    }, timeout);
    const collect = (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > maxBuffer) {
        failure = new Error("Public installer output exceeds its limit.");
        stop();
      }
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    child.once("error", (error) => finish(error));
    child.once("close", (code) => {
      if (!stopping)
        finish(
          code === 0 ? undefined : Object.assign(new Error("Public installer failed."), { code }),
        );
    });
  });

export function parseSkillInstallRequest(input: Record<string, unknown>): SkillInstallRequest {
  if (typeof input.requestId !== "string" || !/^[a-zA-Z0-9_-]{16,100}$/.test(input.requestId))
    throw new Error("Invalid skill installation request identity.");
  if (typeof input.skillId !== "string" || !/^[a-z0-9][a-z0-9-]{0,100}$/.test(input.skillId))
    throw new Error("Invalid catalog skill.");
  if (input.scope !== "project" && input.scope !== "user")
    throw new Error("Choose project or global installation.");
  if (!SKILL_INSTALL_PROVIDERS.includes(input.provider as never))
    throw new Error("Unsupported skill provider.");
  if (typeof input.cwd !== "string" || input.cwd.length > 4096 || input.cwd.includes("\0"))
    throw new Error("Invalid project folder.");
  if (input.scope === "project" && (!input.cwd || !isAbsolute(input.cwd)))
    throw new Error("Choose a project folder before installing a project skill.");
  return {
    requestId: input.requestId,
    skillId: input.skillId,
    scope: input.scope,
    provider: input.provider as SkillInstallRequest["provider"],
    cwd: input.cwd,
  };
}

function portablePath(path: string): boolean {
  return (
    path.length <= 512 &&
    path
      .split("/")
      .every(
        (part) =>
          !!part &&
          part !== "." &&
          part !== ".." &&
          !/[\\:<>"|?*]/.test(part) &&
          ![...part].some(
            (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
          ) &&
          !/[. ]$/.test(part) &&
          !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part),
      )
  );
}

function repositoryParts(repository: string) {
  const url = new URL(repository);
  if (
    url.origin !== "https://github.com" ||
    url.search ||
    url.hash ||
    url.username ||
    url.password ||
    !/^\/[\w.-]+\/[\w.-]+\/?$/.test(url.pathname)
  )
    throw new Error("Catalog source must be an original GitHub repository.");
  return url.pathname.replace(/^\/|\/$/g, "");
}

/** Resolve immutable source identity only; the public CLI owns skill downloads. */
async function boundedDownload(
  url: string,
  limit: number,
  fetcher: typeof fetch,
  deadline: AbortSignal,
): Promise<Buffer> {
  const response = await fetcher(url, {
    redirect: "error",
    signal: deadline,
    headers: { Accept: "application/vnd.github+json", "User-Agent": "bycoda-skill-catalog" },
  });
  if (!response.ok) throw new Error(`Could not download skill source (HTTP ${response.status}).`);
  const declared = Number(response.headers.get("content-length"));
  if (declared > limit) {
    await response.body?.cancel();
    throw new Error("Skill source exceeds download limit.");
  }
  if (!response.body) throw new Error("Skill source returned an empty response.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > limit) throw new Error("Skill source exceeds download limit.");
      chunks.push(next.value);
    }
    return Buffer.concat(chunks);
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

async function sourceFiles(
  skill: RecommendedSkill,
  dependencies: Dependencies,
): Promise<{ commit: string; files: Map<string, { data: Buffer; mode: number }> }> {
  const fetcher = dependencies.fetch ?? fetch;
  const repo = repositoryParts(skill.repository);
  if (skill.skillPath && !portablePath(skill.skillPath))
    throw new Error("Invalid catalog skill path.");
  const deadline = AbortSignal.timeout(90_000);
  const json = async (url: string) =>
    JSON.parse((await boundedDownload(url, 8 * 1024 * 1024, fetcher, deadline)).toString("utf8"));
  const metadata = (await json(
    `https://api.github.com/repos/${repo}/commits/${encodeURIComponent(skill.ref)}`,
  )) as { sha?: unknown };
  if (typeof metadata.sha !== "string" || !/^[a-f0-9]{40}$/.test(metadata.sha))
    throw new Error("Could not resolve the upstream commit.");
  const commit = metadata.sha;
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (major < 22 || (major === 22 && minor < 20))
    throw new Error(
      "The public skill installer requires Node.js 22.20 or newer. Update bycoda Host.",
    );
  const npm =
    dependencies.npmCliPath ??
    [
      dirname(process.execPath),
      dirname(dirname(process.execPath)),
      ...(process.env.PATH ?? process.env.Path ?? "").split(delimiter),
      ...(process.platform === "darwin" ? ["/opt/homebrew/bin", "/usr/local/bin"] : []),
    ]
      .filter(Boolean)
      .flatMap((directory) => [
        join(directory.replace(/^"|"$/g, ""), "node_modules/npm/bin/npm-cli.js"),
        join(directory.replace(/^"|"$/g, ""), "../lib/node_modules/npm/bin/npm-cli.js"),
      ])
      .find(existsSync);
  if (!npm)
    throw new Error(
      "The public skill installer requires npm and Git on this machine. Install Node.js with npm, then retry.",
    );
  const temporaryBase = await realpath(tmpdir());
  const runDirectory = await mkdtemp(join(temporaryBase, "bycoda-skill-source-"));
  const isolatedHome = join(runDirectory, "home");
  const isolatedTemp = join(runDirectory, "tmp");
  await mkdir(isolatedHome);
  await mkdir(isolatedTemp);
  try {
    const command = dependencies.command ?? runSkillInstallerCommand;
    try {
      await command(process.execPath, [npm, ...officialSkillNpmArgs(skill, commit)], {
        cwd: runDirectory,
        windowsHide: true,
        shell: false,
        timeout: 180_000,
        maxBuffer: 1024 * 1024,
        env: {
          ...Object.fromEntries(
            Object.entries(process.env).filter(
              ([key]) =>
                ![
                  "GH_TOKEN",
                  "GITHUB_TOKEN",
                  "NPM_TOKEN",
                  "NODE_AUTH_TOKEN",
                  "GIT_ASKPASS",
                  "SSH_ASKPASS",
                ].includes(key.toUpperCase()) &&
                !/^npm_config_.*(?:auth|token|password|username)/i.test(key),
            ),
          ),
          HOME: isolatedHome,
          USERPROFILE: isolatedHome,
          TMPDIR: isolatedTemp,
          TEMP: isolatedTemp,
          TMP: isolatedTemp,
          XDG_CACHE_HOME: join(runDirectory, "cache"),
          XDG_STATE_HOME: join(runDirectory, "state"),
          XDG_CONFIG_HOME: join(runDirectory, "config"),
          APPDATA: join(isolatedHome, "AppData", "Roaming"),
          LOCALAPPDATA: join(isolatedHome, "AppData", "Local"),
          npm_config_cache: join(runDirectory, "npm-cache"),
          npm_config_userconfig: join(isolatedHome, ".npmrc"),
          npm_config_ignore_scripts: "true",
          npm_config_audit: "false",
          npm_config_fund: "false",
          DISABLE_TELEMETRY: "1",
          CI: "1",
          GIT_TERMINAL_PROMPT: "0",
        },
      });
    } catch (error) {
      const failure = error as { killed?: boolean; code?: string | number };
      if (failure.killed)
        throw new Error(
          "The public skill installer exceeded its three minute deadline. Check installation status before retrying.",
        );
      if (error instanceof Error && error.message === "Public installer output exceeds its limit.")
        throw new Error(
          "The public skill installer produced too much output. Check the original installation instructions.",
        );
      throw new Error(
        typeof failure.code === "number"
          ? `The public skill installer exited with code ${failure.code}. Check npm, Git and the original installation instructions.`
          : "The public skill installer could not run. Check npm, Git and the original installation instructions.",
      );
    }
    const output = join(runDirectory, ".agents", "skills", skill.name);
    for (const path of [
      join(runDirectory, ".agents"),
      join(runDirectory, ".agents", "skills"),
      output,
    ]) {
      const info = await lstat(path);
      if (!info.isDirectory() || info.isSymbolicLink())
        throw new Error("The public installer returned a linked or unavailable skill folder.");
    }
    const files = new Map<string, { data: Buffer; mode: number }>();
    const names = new Set<string>();
    let total = 0;
    let directories = 0;
    const collect = async (folder: string, prefix = ""): Promise<void> => {
      if (++directories > 1024) throw new Error("Skill has too many folders.");
      for (const entry of await readdir(folder, { withFileTypes: true })) {
        const path = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (!portablePath(path) || path.toLowerCase() === MARKER || entry.isSymbolicLink())
          throw new Error("Skill contains an unsafe path, link or reserved file.");
        const folded = path.toLowerCase();
        if (names.has(folded)) throw new Error("Skill contains conflicting file names.");
        names.add(folded);
        const target = join(folder, entry.name);
        const info = await lstat(target);
        if (info.isDirectory()) {
          await collect(target, path);
          continue;
        }
        if (!info.isFile() || info.isSymbolicLink())
          throw new Error("Skill contains an unsupported file.");
        if (files.size >= MAX_FILES || info.size > MAX_FILE_BYTES)
          throw new Error("Skill exceeds file count or 4 MiB file limit.");
        const data = await readFile(target);
        total += data.length;
        if (data.length > MAX_FILE_BYTES || total > MAX_TOTAL_BYTES)
          throw new Error("Skill exceeds 32 MiB or 4 MiB file limit.");
        files.set(path, { data, mode: info.mode & 0o111 ? 0o755 : 0o644 });
      }
    };
    await collect(output);
    const document = files.get("SKILL.md");
    if (!document) throw new Error("The public installer returned no SKILL.md.");
    const frontmatter = document.data
      .toString("utf8")
      .match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1];
    const declaredName = frontmatter?.match(/^name:\s*["']?([^"'\r\n]+?)["']?\s*$/m)?.[1];
    if (!declaredName || declaredName !== skill.name)
      throw new Error("Upstream skill name no longer matches this catalog entry.");
    return { commit, files };
  } finally {
    if (
      dirname(runDirectory) === temporaryBase &&
      relative(temporaryBase, runDirectory).startsWith("bycoda-skill-source-")
    )
      await rm(runDirectory, { recursive: true, force: true });
  }
}

function receiptPath(home: string, requestId: string) {
  return join(home, ".bycoda-host", "skill-installs", `${requestId}.json`);
}
function sameRequest(left: SkillInstallRequest, right: SkillInstallRequest) {
  return JSON.stringify(left) === JSON.stringify(right);
}
async function receipt(home: string, request: SkillInstallRequest): Promise<Receipt | undefined> {
  const read = await readStateFile(
    receiptPath(home, request.requestId),
    (text) => {
      const parsed = JSON.parse(text) as Receipt;
      if (!parsed?.request || !parsed.result || typeof parsed.destination !== "string")
        throw new Error("Invalid installation receipt.");
      if (!sameRequest(parsed.request, request))
        throw new Error("Installation request identity belongs to another selection.");
      return parsed;
    },
    { quarantine: false },
  );
  if (read.status === "corrupt")
    throw new Error("Could not read this installation's receipt. Preserve it before recovery.");
  return read.status === "ok" ? read.value : undefined;
}

async function verifiedResult(stored: Receipt): Promise<SkillInstallResult> {
  try {
    const marker = JSON.parse(
      await readFile(join(stored.destination, MARKER), "utf8"),
    ) as InstallMarker;
    if (
      marker.schemaVersion !== 1 ||
      marker.provider !== stored.request.provider ||
      marker.requestId !== stored.request.requestId ||
      marker.skillId !== stored.request.skillId ||
      !/^[a-f0-9]{40}$/.test(marker.commit) ||
      !marker.files ||
      !Object.hasOwn(marker.files, "SKILL.md")
    )
      throw new Error("Installation files do not match this operation.");
    for (const [path, expected] of Object.entries(marker.files)) {
      if (!portablePath(path)) throw new Error("Invalid installed path.");
      const file = join(stored.destination, path);
      const info = await lstat(file);
      if (!info.isFile() || hash(await readFile(file)) !== expected)
        throw new Error("Installed files have changed.");
    }
    return {
      ...stored.result,
      status: "installed",
      path: join(stored.destination, "SKILL.md"),
      commit: marker.commit,
      error: undefined,
    };
  } catch (error) {
    if (stored.result.status === "failed") return stored.result;
    return {
      ...stored.result,
      status: "unknown",
      error: error instanceof Error ? error.message : "Installation outcome is unknown.",
    };
  }
}

export async function skillInstallStatus(
  input: Record<string, unknown>,
  dependencies: Dependencies = {},
): Promise<SkillInstallResult> {
  const request = parseSkillInstallRequest(input);
  const home = dependencies.home ?? homedir();
  const running = active.get(`${resolve(home)}:${request.requestId}`);
  if (running && !sameRequest(running.request, request))
    throw new Error("Installation request identity belongs to another selection.");
  const stored = await receipt(home, request);
  if (!stored)
    return {
      requestId: request.requestId,
      skillId: request.skillId,
      status: "unknown",
      error: "No installation receipt was found. Do not resend an uncertain installation.",
    };
  if (running && stored.result.status === "pending") return stored.result;
  return await verifiedResult(stored);
}

/** Refuse linked ancestors instead of installing through a redirected skill root. */
async function safeRoot(base: string, relativeRoot: string) {
  let current = await realpath(base);
  for (const segment of relativeRoot.split("/")) {
    current = join(current, segment);
    try {
      await mkdir(current);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    const info = await lstat(current);
    if (!info.isDirectory() || info.isSymbolicLink())
      throw new Error("Skill installation folder is linked or unavailable.");
  }
  return current;
}

export async function installCatalogSkill(
  input: Record<string, unknown>,
  dependencies: Dependencies = {},
): Promise<SkillInstallResult> {
  const request = parseSkillInstallRequest(input);
  const home = dependencies.home ?? homedir();
  const key = `${resolve(home)}:${request.requestId}`;
  const existing = await receipt(home, request);
  if (existing) return await skillInstallStatus(input, dependencies);
  const running = active.get(key);
  if (running) {
    if (!sameRequest(running.request, request))
      throw new Error("Installation request identity belongs to another selection.");
    return await running.promise;
  }
  const pending = performInstall(request, { ...dependencies, home });
  active.set(key, { request, promise: pending });
  try {
    return await pending;
  } finally {
    active.delete(key);
  }
}

async function performInstall(
  request: SkillInstallRequest,
  dependencies: Dependencies & { home: string },
): Promise<SkillInstallResult> {
  const { home } = dependencies;
  const skill = (dependencies.catalog ?? RECOMMENDED_SKILLS).find(
    (entry) => entry.id === request.skillId,
  );
  if (!skill || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(skill.name))
    throw new Error("This skill is not in the recommended catalog.");
  const source =
    request.provider === "all"
      ? ".agents"
      : request.provider === "antigravity"
        ? ".gemini/antigravity"
        : `.${request.provider}`;
  const base = request.scope === "project" ? request.cwd : home;
  const destination = join(await realpath(base), source, "skills", skill.name);
  const allowed = () => {
    if (
      skillDisabled(readSkillPolicy(home), {
        name: skill.name,
        path: join(destination, "SKILL.md"),
      })
    )
      throw new Error("This skill is disabled on this machine.");
  };
  allowed();
  const root = await safeRoot(base, `${source}/skills`);
  // Exclusive operation receipt across concurrent processes, then atomic state updates.
  const operation = receiptPath(home, request.requestId);
  await mkdir(dirname(operation), { recursive: true });
  const lock = `${operation}.lock`;
  try {
    await mkdir(lock);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST")
      return await skillInstallStatus(request, dependencies);
    throw error;
  }
  let stored: Receipt = {
    request,
    destination,
    result: { requestId: request.requestId, skillId: request.skillId, status: "pending" },
  };
  let stage: string | undefined;
  let createdDestination = false;
  let destinationIdentity: { ino: number; dev: number } | undefined;
  const copied: { path: string; hash: string }[] = [];
  try {
    await writeFileAtomic(operation, JSON.stringify(stored));
    try {
      await lstat(destination);
      throw new Error("A skill with this name already exists at the selected destination.");
    } catch (error) {
      if (!missing(error)) throw error;
    }
    const upstream = await sourceFiles(skill, dependencies);
    stage = await mkdtemp(join(root, ".bycoda-install-"));
    for (const [path, file] of upstream.files) {
      const target = join(stage, path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, file.data, { flag: "wx", mode: file.mode });
    }
    allowed();
    await mkdir(destination); // Exclusive reservation: never replace any existing folder.
    createdDestination = true;
    destinationIdentity = await lstat(destination);
    const marker: InstallMarker = {
      schemaVersion: 1,
      provider: request.provider,
      skillId: skill.id,
      repository: skill.repository,
      commit: upstream.commit,
      requestId: request.requestId,
      installer: SKILLS_CLI_PACKAGE,
      files: Object.fromEntries([...upstream.files].map(([path, file]) => [path, hash(file.data)])),
    };
    for (const [path, file] of upstream.files) {
      if (path === "SKILL.md") continue;
      const target = join(destination, path);
      await mkdir(dirname(target), { recursive: true });
      await copyFile(join(stage, path), target, constants.COPYFILE_EXCL);
      copied.push({ path: target, hash: marker.files[path] });
      await chmod(target, file.mode);
    }
    const markerText = JSON.stringify(marker);
    await writeFileAtomic(join(destination, MARKER), markerText);
    copied.push({ path: join(destination, MARKER), hash: hash(markerText) });
    allowed();
    // Discovery publication point: all support files + provider marker exist first.
    await copyFile(join(stage, "SKILL.md"), join(destination, "SKILL.md"), constants.COPYFILE_EXCL);
    copied.push({ path: join(destination, "SKILL.md"), hash: marker.files["SKILL.md"] });
    stored = {
      ...stored,
      result: {
        ...stored.result,
        status: "installed",
        path: join(destination, "SKILL.md"),
        commit: upstream.commit,
      },
    };
    stored.result = await verifiedResult(stored);
    await writeFileAtomic(operation, JSON.stringify(stored));
    return stored.result;
  } catch (error) {
    const verified = createdDestination ? await verifiedResult(stored) : undefined;
    if (verified?.status === "installed") return verified;
    // Remove only files this operation created. Retain anything created by another writer.
    const currentDestination = await lstat(destination).catch(() => undefined);
    const stillOwned =
      destinationIdentity &&
      currentDestination?.ino === destinationIdentity.ino &&
      currentDestination?.dev === destinationIdentity.dev &&
      currentDestination.isDirectory() &&
      !currentDestination.isSymbolicLink();
    if (stillOwned)
      for (const file of copied.reverse()) {
        const info = await lstat(file.path).catch(() => undefined);
        if (info?.isFile() && hash(await readFile(file.path)) === file.hash)
          await unlink(file.path).catch(() => undefined);
      }
    if (createdDestination && stillOwned) {
      const removeEmpty = async (folder: string): Promise<void> => {
        for (const child of await readdir(folder, { withFileTypes: true }).catch(() => []))
          if (child.isDirectory()) await removeEmpty(join(folder, child.name));
        await rmdir(folder).catch(() => undefined);
      };
      await removeEmpty(destination);
    }
    stored.result = {
      ...stored.result,
      status: "failed",
      error: error instanceof Error ? error.message : "Skill installation failed.",
    };
    await writeFileAtomic(operation, JSON.stringify(stored));
    return stored.result;
  } finally {
    // The only recursive removal is our exclusive stage under the checked skill root.
    if (stage && relative(root, stage).startsWith(".bycoda-install-") && dirname(stage) === root)
      await rm(stage, { recursive: true, force: true });
    await rmdir(lock).catch(() => undefined);
  }
}
