import { execFileAsync as exec } from "../src/shared/lib/processExecution.node";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { withHostGitMutation } from "./git-mutations";
import {
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { GitChangedFile, GitDiffIndex, GitFileDiff } from "../src/platform/tauri/fs";
import { hostOperationState, hostUnmerged, unmergedMessage } from "./git-conflicts";
import type { ProjectSearchMatch, ProjectSearchResult } from "../src/features/search/model/search";

const MAX_FILE = 1024 * 1024;

export function workspacePath(root: string, input: unknown, allowRoot = false): string {
  if (typeof input !== "string" || input.length > 4096 || input.includes("\0"))
    throw new Error("Invalid workspace path");
  const path = resolve(root, input);
  const rel = relative(root, path);
  if (
    (!allowRoot && !rel) ||
    rel === ".." ||
    rel.startsWith(`..${sep}`) ||
    isAbsolute(rel) ||
    rel.split(sep).some((part) => part.toLowerCase() === ".git")
  )
    throw new Error("Path is outside the workspace");
  return path;
}

export async function existingPath(root: string, input: unknown, allowRoot = false) {
  const path = workspacePath(root, input, allowRoot);
  const actual = await realpath(path);
  // Compare resolved paths on both sides: a project under a linked folder
  // (macOS /var, a symlinked home) or a Windows 8.3 short name is still inside.
  const rel = relative(await realpath(root).catch(() => root), actual);
  if (
    (!allowRoot && !rel) ||
    rel === ".." ||
    rel.startsWith(`..${sep}`) ||
    isAbsolute(rel) ||
    rel.split(sep).some((part) => part.toLowerCase() === ".git")
  )
    throw new Error("Path is outside the workspace");
  // Callers relate the result to `root`, so express it in root's own form.
  return rel ? resolve(root, rel) : root;
}

/** Git file actions also validate deleted paths through their existing ancestors. */
export async function safeGitPath(root: string, input: unknown): Promise<string> {
  if (typeof input !== "string") throw new Error("Invalid Git path");
  if (input.split(/[\\/]/).includes("..")) throw new Error("Path is outside the workspace");
  const path = workspacePath(root, input);
  const canonicalRoot = await realpath(root);
  let ancestor = path;
  for (;;) {
    try {
      await lstat(ancestor);
      const actual = await realpath(ancestor);
      const rel = relative(canonicalRoot, actual);
      if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel))
        throw new Error("Path is outside the checkout");
      return path;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      const parent = resolve(ancestor, "..");
      if (parent === ancestor) throw new Error("Invalid Git path");
      ancestor = parent;
    }
  }
}

async function git(
  root: string,
  args: string[],
  maxBuffer = 4 * 1024 * 1024,
  timeout = 10_000,
  literalPaths = args.includes("--") && args[0] !== "check-ignore" && args[0] !== "grep",
) {
  try {
    return (
      await exec(
        "git",
        [...(literalPaths ? ["--literal-pathspecs"] : []), "-c", "core.pager=cat", ...args],
        {
          cwd: root,
          timeout: ["add", "restore", "rm", "commit"].includes(args[0])
            ? Math.max(timeout, 120_000)
            : timeout,
          maxBuffer,
          encoding: "utf8",
          windowsHide: true,
          env: { ...process.env, LC_ALL: "C", GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0" },
        },
      )
    ).stdout;
  } catch (reason) {
    if (
      (reason as { killed?: boolean }).killed &&
      (reason as { code?: string }).code !== "ERR_CHILD_PROCESS_STDIO_MAXBUFFER"
    )
      throw new Error(`git ${args[0]} timed out after ${timeout / 1000} seconds`);
    throw reason;
  }
}

function gitWithInput(
  root: string,
  args: string[],
  input: string,
  timeout = 10_000,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", ["--literal-pathspecs", "-c", "core.pager=cat", ...args], {
      cwd: root,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, LC_ALL: "C", GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0" },
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let inputError: Error | undefined;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
      // A helper can inherit the pipes after Git exits. Do not wait forever for
      // its handles to close before releasing the failed operation's queue slot.
      child.stdin.destroy();
      child.stdout.destroy();
      child.stderr.destroy();
      reject(new Error(`git ${args[0]} timed out after ${timeout / 1000} seconds`));
    }, timeout);
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    // Git may reject a locked index before consuming stdin. Keep its stderr
    // rather than replacing the useful lock error with EPIPE.
    child.stdin.on("error", (error) => {
      inputError = error;
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) reject(new Error(`git ${args[0]} timed out after ${timeout / 1000} seconds`));
      else if (code === 0 && inputError) reject(inputError);
      else if (code === 0) resolve(Buffer.concat(stdout).toString("utf8"));
      else reject(new Error(Buffer.concat(stderr).toString("utf8") || `git exited ${code}`));
    });
    child.stdin.end(input);
  });
}

export type HostFileEntry = {
  name: string;
  path: string;
  isDir: boolean;
  ignored: boolean;
};

export async function listHostFiles(root: string, input: unknown): Promise<HostFileEntry[]> {
  const dir = await existingPath(root, input, true);
  if (!(await stat(dir)).isDirectory()) throw new Error("Path is not a directory");
  const entries = await readdir(dir, { withFileTypes: true });
  if (entries.length > 5000) throw new Error("Directory has too many entries to display");
  const visible = entries.filter((entry) => entry.name !== ".DS_Store");
  const paths = visible.map((entry) =>
    relative(root, resolve(dir, entry.name)).split(sep).join("/"),
  );
  let ignored = new Set<string>();
  if (paths.length) {
    try {
      const output = await git(root, ["check-ignore", "-z", "--", ...paths]);
      ignored = new Set(output.split("\0").filter(Boolean));
    } catch {
      /* no ignored entries or a non-Git folder */
    }
  }
  const out = await Promise.all(
    visible.map(async (entry, index) => {
      const path = paths[index];
      const isDir =
        entry.isDirectory() ||
        (entry.isSymbolicLink() &&
          (await existingPath(root, path)
            .then((actual) => stat(actual))
            .then((value) => value.isDirectory())
            .catch(() => false)));
      return {
        name: entry.name,
        path,
        isDir,
        ignored: entry.name === ".git" || ignored.has(path),
      };
    }),
  );
  return out.sort(
    (a, b) =>
      Number(b.isDir) - Number(a.isDir) ||
      a.name.localeCompare(b.name, undefined, {
        numeric: true,
        sensitivity: "base",
      }),
  );
}

/** Upper bound on paths sent for Go to File, as for a local project. */
const MAX_INDEXED_FILES = 20_000;

const FILE_PATHS_TTL_MS = 3_000;
const FILE_PATHS_CACHE_LIMIT = 16;
const filePathCache = new Map<
  string,
  { at: number; generation: number; paths: Promise<string[]> }
>();
let filePathGeneration = 0;

/**
 * Drop cached file lists after this host changes files or git state. Without a
 * root, every list is dropped.
 */
export function invalidateHostFilePaths(root?: string): void {
  filePathGeneration++;
  if (root === undefined) filePathCache.clear();
  else filePathCache.delete(root);
}

/** Cached for a few seconds, so typing in Go to File does not spawn git per key. */
function hostFilePaths(root: string): Promise<string[]> {
  const now = Date.now();
  const hit = filePathCache.get(root);
  if (hit && hit.generation === filePathGeneration && now - hit.at < FILE_PATHS_TTL_MS)
    return hit.paths;
  const entry = {
    at: now,
    generation: filePathGeneration,
    paths: scanHostFilePaths(root),
  };
  filePathCache.delete(root);
  filePathCache.set(root, entry);
  while (filePathCache.size > FILE_PATHS_CACHE_LIMIT)
    filePathCache.delete(filePathCache.keys().next().value as string);
  // Failures are not cached; a later call retries.
  entry.paths.catch(() => {
    if (filePathCache.get(root) === entry) filePathCache.delete(root);
  });
  return entry.paths;
}

/** Every file in the worktree, honoring .gitignore when it is a repository. */
async function scanHostFilePaths(root: string): Promise<string[]> {
  let paths: string[];
  let repository = false;
  try {
    repository = (await git(root, ["rev-parse", "--is-inside-work-tree"])).trim() === "true";
  } catch (error) {
    if (!String((error as { stderr?: string }).stderr).includes("not a git repository"))
      throw error;
  }
  if (repository) {
    const listed = await git(
      root,
      ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
      8 * 1024 * 1024,
    );
    const deleted = await git(root, ["ls-files", "-z", "--deleted"], 8 * 1024 * 1024);
    // Cached entries include worktree deletions. Keep those in Changes, but not
    // in file-opening results; both Git lists use the same relative coordinates.
    const deletedPaths = new Set(deleted.split("\0"));
    paths = listed.split("\0").filter((path) => path.length > 0 && !deletedPaths.has(path));
  } else {
    paths = [];
    const pending = [""];
    while (pending.length && paths.length < 5000) {
      const dir = pending.pop()!;
      const entries = await readdir(resolve(root, dir), {
        withFileTypes: true,
      }).catch(() => []);
      for (const entry of entries) {
        if (entry.name === ".git" || entry.name === "node_modules") continue;
        const path = dir ? `${dir}/${entry.name}` : entry.name;
        if (entry.isDirectory()) pending.push(path);
        else if (entry.isFile()) paths.push(path);
      }
    }
  }
  return paths;
}

/** Relative paths of the worktree's files, for fuzzy Go to File on the client. */
export async function indexHostFiles(root: string): Promise<string[]> {
  return (await hostFilePaths(root)).slice(0, MAX_INDEXED_FILES);
}

/** Bounded filename search for the remote Explorer. */
export async function searchHostFiles(root: string, input: unknown): Promise<HostFileEntry[]> {
  if (typeof input !== "string" || input.length > 200) throw new Error("Invalid search");
  const query = input.trim().toLocaleLowerCase();
  if (!query) return [];
  return (await hostFilePaths(root))
    .filter((path) => path.toLocaleLowerCase().includes(query))
    .slice(0, 200)
    .map((path) => ({
      name: path.split("/").pop() || path,
      path,
      isDir: false,
      ignored: false,
    }));
}

type ContentSearchOptions = {
  query: string;
  caseSensitive: boolean;
  wholeWord: boolean;
  regex: boolean;
  include: string[];
  exclude: string[];
};

function searchOptions(input: unknown): ContentSearchOptions {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("Invalid search");
  const value = input as Record<string, unknown>;
  if (
    typeof value.query !== "string" ||
    value.query.length > 200 ||
    value.query.includes("\0") ||
    [value.include, value.exclude].some(
      (item) =>
        item !== undefined &&
        (typeof item !== "string" || item.length > 1000 || item.includes("\0")),
    )
  )
    throw new Error("Invalid search");
  for (const key of ["caseSensitive", "wholeWord", "regex"])
    if (value[key] !== undefined && typeof value[key] !== "boolean")
      throw new Error("Invalid search");
  const tokens = (item: unknown) =>
    (typeof item === "string" ? item : "")
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
  return {
    query: value.query,
    caseSensitive: value.caseSensitive === true,
    wholeWord: value.wholeWord === true,
    regex: value.regex === true,
    include: tokens(value.include),
    exclude: tokens(value.exclude),
  };
}

function searchColumn(line: string, options: ContentSearchOptions): number {
  const pattern = new RegExp(
    options.query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    options.caseSensitive ? "g" : "gi",
  );
  for (const match of line.matchAll(pattern)) {
    if (options.wholeWord) {
      // Match complete code points, including letters outside the BMP.
      const before = line.slice(0, match.index);
      const after = line.slice(match.index + match[0].length);
      if (/[\p{L}\p{N}_]$/u.test(before) || /^[\p{L}\p{N}_]/u.test(after)) continue;
    }
    return match.index + 1;
  }
  return 0;
}

/** Search file contents with the same controls and result shape as local search. */
export async function searchHostContent(
  root: string,
  input: unknown,
): Promise<ProjectSearchResult> {
  const options = searchOptions(input);
  if (!options.query) return { matches: [], truncated: false };
  const args = ["grep", "--untracked", "-z", "-n", "--column"];
  if (!options.caseSensitive) args.push("-i");
  if (options.wholeWord && options.regex) args.push("-w");
  args.push(options.regex ? "-E" : "-F", "-e", options.query, "--");
  args.push(...options.include, ...options.exclude.map((glob) => `:(exclude)${glob}`));
  let output: string | undefined;
  let outputTruncated = false;
  try {
    // Search includes/excludes deliberately use glob and pathspec magic.
    output = await git(root, args, 8 * 1024 * 1024, 10_000, false);
  } catch (reason) {
    const error = reason as { code?: number | string; stdout?: string };
    if (error.code === 1 || error.code === "1") return { matches: [], truncated: false };
    if (error.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" && typeof error.stdout === "string") {
      output = error.stdout;
      outputTruncated = true;
    } else if (!/not a git repository|not in a git directory/i.test(String(reason))) {
      throw reason;
    }
  }
  if (output !== undefined) {
    const matches: ProjectSearchMatch[] = [];
    let offset = 0;
    while (offset < output.length && matches.length < 501) {
      const pathEnd = output.indexOf("\0", offset);
      const lineEnd = output.indexOf("\0", pathEnd + 1);
      const columnEnd = output.indexOf("\0", lineEnd + 1);
      const previewEnd = output.indexOf("\n", columnEnd + 1);
      if (pathEnd < 0 || lineEnd < 0 || columnEnd < 0) break;
      // A buffer-limited process may end in the middle of a result record.
      if (outputTruncated && previewEnd < 0) break;
      const relative = output.slice(offset, pathEnd).replace(/\\/g, "/");
      const preview = output.slice(columnEnd + 1, previewEnd < 0 ? undefined : previewEnd);
      offset = previewEnd < 0 ? output.length : previewEnd + 1;
      if (!relative || !Number.isFinite(Number(output.slice(pathEnd + 1, lineEnd)))) continue;
      const path = workspacePath(root, relative);
      const byteColumn = Number(output.slice(lineEnd + 1, columnEnd));
      // Git columns count UTF-8 bytes; editor columns count UTF-16 code units.
      const column = options.regex
        ? Buffer.from(preview)
            .subarray(0, byteColumn - 1)
            .toString("utf8").length + 1
        : searchColumn(preview, options);
      if (!column || !Number.isInteger(byteColumn) || byteColumn < 1) continue;
      matches.push({
        path: path.split(sep).join("/"),
        relative,
        line: Number(output.slice(pathEnd + 1, lineEnd)),
        column,
        preview,
      });
    }
    return { matches: matches.slice(0, 500), truncated: outputTruncated || matches.length > 500 };
  }

  // Ordinary folders use a bounded text scan, like the local fallback.
  if (options.regex) throw new Error("Regex search is unavailable outside Git repositories.");
  const matches: ProjectSearchMatch[] = [];
  const pending = [""];
  let files = 0;
  let truncated = false;
  while (pending.length && matches.length <= 500 && files < 5000) {
    const parent = pending.pop()!;
    const entries = await readdir(resolve(root, parent), {
      withFileTypes: true,
    }).catch(() => []);
    for (const entry of entries) {
      if (entry.name === ".git" || entry.name === "node_modules") continue;
      const relative = parent ? `${parent}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        pending.push(relative);
        continue;
      }
      if (!entry.isFile()) continue;
      files++;
      if (files > 5000) {
        truncated = true;
        break;
      }
      if (!matchesFilters(relative, options)) continue;
      let content: string;
      let path: string;
      try {
        path = await existingPath(root, relative);
        if ((await stat(path)).size > 512 * 1024) continue;
        content = await readHostFile(root, relative);
      } catch {
        continue;
      }
      for (const [index, line] of content.split(/\r?\n/).entries()) {
        const column = searchColumn(line, options);
        if (!column) continue;
        matches.push({
          path: path.split(sep).join("/"),
          relative,
          line: index + 1,
          column,
          preview: line,
        });
        if (matches.length > 500) {
          truncated = true;
          break;
        }
      }
      if (matches.length > 500) break;
    }
  }
  if (files >= 5000 && pending.length) truncated = true;
  return { matches: matches.slice(0, 500), truncated };
}

function matchesFilters(path: string, options: ContentSearchOptions): boolean {
  const matches = (glob: string) => {
    const normalized = glob.replace(/^\.\//, "");
    if (!/[?*]/.test(normalized)) return path === normalized || path.startsWith(`${normalized}/`);
    const pattern = normalized
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*\*\//g, "\u0001")
      .replace(/\*\*/g, "\u0000")
      .replace(/\*/g, "[^/]*")
      .replace(/\?/g, "[^/]")
      .replace(/\u0000/g, ".*")
      .replace(/\u0001/g, "(?:.*/)?");
    const regex = new RegExp(`^${pattern}$`);
    return regex.test(path) || (!normalized.includes("/") && regex.test(path.split("/").pop()!));
  };
  return (
    (!options.include.length || options.include.some(matches)) && !options.exclude.some(matches)
  );
}

export async function readHostFile(root: string, input: unknown): Promise<string> {
  const path = await existingPath(root, input);
  const info = await stat(path);
  if (!info.isFile()) throw new Error("Path is not a file");
  if (info.size > MAX_FILE) throw new Error("File is too large to preview");
  const bytes = await readFile(path);
  if (bytes.includes(0)) throw new Error("Binary file cannot be previewed");
  return bytes.toString("utf8");
}

const hostFileWrites = new Map<string, Promise<void>>();

export async function writeHostFile(
  root: string,
  input: unknown,
  expected: unknown,
  content: unknown,
) {
  if (
    typeof expected !== "string" ||
    typeof content !== "string" ||
    Buffer.byteLength(content, "utf8") > MAX_FILE ||
    content.includes("\0")
  )
    throw new Error("Invalid file content");
  const path = await existingPath(root, input);
  const canonical = await realpath(path);
  const key = process.platform === "win32" ? canonical.toLowerCase() : canonical;
  const write = async () => {
    const current = await readHostFile(root, input);
    if (current !== expected) throw new Error("File changed on the host; reload before saving");
    try {
      await writeFile(path, content, "utf8");
    } finally {
      invalidateHostGitIndex(root);
    }
  };
  // The comparison belongs inside the queue: two clients may read the same
  // version, but only the first write may replace that version.
  const pending = (hostFileWrites.get(key) ?? Promise.resolve()).then(write, write);
  hostFileWrites.set(key, pending);
  try {
    await pending;
  } finally {
    if (hostFileWrites.get(key) === pending) hostFileWrites.delete(key);
  }
}

/** Create a new file or folder under an existing workspace directory. */
export async function createHostPath(
  root: string,
  parent: unknown,
  name: unknown,
  isDir: unknown,
): Promise<string> {
  if (
    typeof name !== "string" ||
    typeof isDir !== "boolean" ||
    !name ||
    name.length > 4096 ||
    name.includes("\0") ||
    /^[\\/]/.test(name)
  )
    throw new Error("Invalid file name");
  const parts = name.replace(/[\\/]+$/, "").split(/[\\/]/);
  if (
    !parts.length ||
    parts.some(
      (part) =>
        !part ||
        part === "." ||
        part === ".." ||
        part.toLowerCase() === ".git" ||
        part.length > 255 ||
        /^\s+$/.test(part),
    )
  )
    throw new Error("Invalid file name");
  let directory = await existingPath(root, parent, true);
  if (!(await stat(directory)).isDirectory()) throw new Error("Path is not a directory");
  for (const part of parts.slice(0, -1)) {
    const candidate = workspacePath(root, relative(root, resolve(directory, part)));
    await mkdir(candidate).catch((reason: NodeJS.ErrnoException) => {
      if (reason.code !== "EEXIST") throw reason;
    });
    directory = await existingPath(root, relative(root, candidate));
    if (!(await stat(directory)).isDirectory()) throw new Error("Path is not a directory");
  }
  const path = workspacePath(root, relative(root, resolve(directory, parts.at(-1)!)));
  try {
    if (isDir) await mkdir(path);
    else {
      const file = await open(path, "wx");
      await file.close();
    }
  } finally {
    invalidateHostFilePaths(root);
    invalidateHostGitIndex(root);
  }
  return relative(root, path).split(sep).join("/");
}

/** `git status` codes for unmerged paths: UU, AA, DD, AU, UA, DU, UD. */
const UNMERGED_CODES: ReadonlySet<string> = new Set(["UU", "AA", "DD", "AU", "UA", "DU", "UD"]);

function statusName(code: string): string {
  if (code === "??") return "untracked";
  if (code.includes("D")) return "deleted";
  if (code.includes("A") || code.includes("?")) return "added";
  return "modified";
}

const gitIndexInflight = new Map<string, { generation: number; value: Promise<GitDiffIndex> }>();
let gitIndexGeneration = 0;

/** A caller that starts after this must not join a refresh begun before it. */
export function invalidateHostGitIndex(root?: string): void {
  gitIndexGeneration++;
  if (root === undefined) gitIndexInflight.clear();
  else gitIndexInflight.delete(root);
}

/** Concurrent callers for one root share a single refresh. */
export function hostGitIndex(root: string): Promise<GitDiffIndex> {
  const running = gitIndexInflight.get(root);
  if (running && running.generation === gitIndexGeneration) return running.value;
  const entry = {
    generation: gitIndexGeneration,
    value: readHostGitIndex(root),
  };
  gitIndexInflight.set(root, entry);
  const done = () => {
    if (gitIndexInflight.get(root) === entry) gitIndexInflight.delete(root);
  };
  entry.value.then(done, done);
  return entry.value;
}

/** Status entries only: no line counts or branch data. Optionally limited to paths. */
async function hostChangedEntries(root: string, paths?: string[]): Promise<GitChangedFile[]> {
  const files = await readChangedEntries(root, paths);
  if (!paths) return files;
  // A pathspec hides the rename source, so a staged rename shows as an add.
  // The full status pairs them; use it for those paths to match hostGitIndex.
  if (!files.some((file) => file.staged && file.status === "added")) return files;
  const wanted = new Set(paths);
  return (await readChangedEntries(root)).filter((file) => wanted.has(file.relative));
}

type ChangedEntry = GitChangedFile & { originalPath?: string; stagedRename?: boolean };

async function readChangedEntries(root: string, paths?: string[]): Promise<ChangedEntry[]> {
  const prefix = (await git(root, ["rev-parse", "--show-prefix"])).trim();
  const text = await git(root, [
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=all",
    ...(paths ? ["--", ...paths] : []),
  ]);
  const parts = text.split("\0");
  const files: ChangedEntry[] = [];
  for (let index = 0; index < parts.length; index++) {
    const item = parts[index];
    if (!item || item.length < 4) continue;
    const code = item.slice(0, 2);
    const repositoryPath = item.slice(3);
    const originalPath = code.includes("R") || code.includes("C") ? parts[++index] : undefined;
    if (!repositoryPath.startsWith(prefix)) continue;
    const path = repositoryPath.slice(prefix.length);
    if (UNMERGED_CODES.has(code)) continue;
    files.push({
      path,
      relative: path,
      ...(originalPath ? { originalPath } : {}),
      ...(code[0] === "R" ? { stagedRename: true } : {}),
      status: statusName(code),
      additions: 0,
      deletions: 0,
      staged: code[0] !== " " && code !== "??",
      unstaged: code[1] !== " " || code === "??",
    });
  }
  return files;
}

const UNTRACKED_COUNT_CONCURRENCY = 8;
const UNTRACKED_COUNT_BUDGET = 16 * MAX_FILE;

async function countLines(path: string): Promise<number> {
  const bytes = await readFile(path);
  if (!bytes.length) return 0;
  let lines = 0;
  for (let at = bytes.indexOf(10); at !== -1; at = bytes.indexOf(10, at + 1)) lines++;
  return lines + Number(bytes[bytes.length - 1] !== 10);
}

async function readHostGitIndex(root: string): Promise<GitDiffIndex> {
  // An ordinary folder has an empty Changes view, just as it does locally.
  const repository = await git(root, ["rev-parse", "--is-inside-work-tree"]).catch((error) => {
    if (String(error).includes("not a git repository")) return "";
    throw error;
  });
  if (repository.trim() !== "true") {
    return {
      repository: false,
      branch: null,
      head: null,
      files: [],
      additions: 0,
      deletions: 0,
      remote: null,
      upstream: null,
      defaultBranch: null,
      ahead: 0,
      behind: 0,
      aheadOfDefault: 0,
      headPushed: false,
      conflicts: [],
      operation: null,
    };
  }
  const [
    branchText,
    headText,
    statusText,
    numstat,
    remoteText,
    upstreamText,
    countsText,
    defaultText,
    conflicts,
    operation,
    pushedText,
  ] = await Promise.all([
    git(root, ["symbolic-ref", "--quiet", "--short", "HEAD"]).catch(() => ""),
    git(root, ["rev-parse", "--verify", "HEAD"]).catch(() => ""),
    git(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]),
    git(root, [
      "diff",
      "--relative",
      "--no-ext-diff",
      "--no-textconv",
      "--numstat",
      "-z",
      "HEAD",
      "--",
    ]).catch(() =>
      git(root, [
        "diff",
        "--cached",
        "--relative",
        "--no-ext-diff",
        "--no-textconv",
        "--numstat",
        "-z",
        "--",
      ]),
    ),
    git(root, ["remote", "get-url", "origin"]).catch(() => ""),
    git(root, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"]).catch(() => ""),
    git(root, ["rev-list", "--left-right", "--count", "@{upstream}...HEAD"]).catch(() => ""),
    git(root, ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"]).catch(() => ""),
    hostUnmerged(root),
    hostOperationState(root),
    git(root, ["for-each-ref", "--count=1", "--contains", "HEAD", "refs/remotes"]).catch(() => ""),
  ]);
  let [behind, ahead] = countsText.trim().split(/\s+/).map(Number);
  let defaultBranch = defaultText.trim().replace(/^origin\//, "");
  if (!defaultBranch && remoteText.trim()) {
    for (const name of ["main", "master"]) {
      const exists = await git(root, ["rev-parse", "--verify", `refs/remotes/origin/${name}`]).then(
        () => true,
        () => false,
      );
      if (exists) {
        defaultBranch = name;
        break;
      }
    }
  }
  if (!upstreamText.trim() && defaultBranch) {
    const fallback = await git(root, [
      "rev-list",
      "--left-right",
      "--count",
      `origin/${defaultBranch}...HEAD`,
    ]).catch(() => "");
    [behind, ahead] = fallback.trim().split(/\s+/).map(Number);
  }
  const headPushed = Boolean(pushedText.trim());
  const aheadOfDefault = defaultBranch
    ? Number(
        (
          await git(root, ["rev-list", "--count", `origin/${defaultBranch}..HEAD`]).catch(() => "0")
        ).trim(),
      ) || 0
    : 0;
  const counts = new Map<string, { additions: number; deletions: number }>();
  const statParts = numstat.split("\0");
  for (let index = 0; index < statParts.length; index++) {
    const match = /^(\d+|-)\t(\d+|-)\t([\s\S]*)$/.exec(statParts[index]);
    if (match) {
      let path = match[3];
      if (!path) {
        index++;
        path = statParts[++index];
      }
      counts.set(path, {
        additions: Number(match[1]) || 0,
        deletions: Number(match[2]) || 0,
      });
    }
  }
  const prefix = (await git(root, ["rev-parse", "--show-prefix"])).trim();
  const parts = statusText.split("\0");
  const files: GitChangedFile[] = [];
  const untracked: GitChangedFile[] = [];
  for (let index = 0; index < parts.length; index++) {
    const item = parts[index];
    if (!item || item.length < 4) continue;
    const code = item.slice(0, 2);
    const repositoryPath = item.slice(3);
    if (code.includes("R") || code.includes("C")) index++;
    if (!repositoryPath.startsWith(prefix)) continue;
    const path = repositoryPath.slice(prefix.length);
    // Unmerged paths are listed under `conflicts`, not as ordinary changes.
    if (UNMERGED_CODES.has(code)) continue;
    const count = counts.get(path) ?? { additions: 0, deletions: 0 };
    const file: GitChangedFile = {
      path,
      relative: path,
      status: statusName(code),
      additions: count.additions,
      deletions: count.deletions,
      staged: code[0] !== " " && code !== "??",
      unstaged: code[1] !== " " || code === "??",
    };
    if (code === "??") untracked.push(file);
    files.push(file);
  }
  // Untracked files have no numstat. Count their lines with bounded
  // concurrency and a total byte budget so a huge untracked tree stays cheap.
  let budget = UNTRACKED_COUNT_BUDGET;
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(UNTRACKED_COUNT_CONCURRENCY, untracked.length) }, async () => {
      while (next < untracked.length) {
        const file = untracked[next++];
        try {
          const full = resolve(root, file.path);
          const info = await lstat(full);
          if (!info.isFile() || info.size > MAX_FILE || info.size > budget) continue;
          budget -= info.size;
          file.additions = await countLines(full);
        } catch {
          /* a file may change during refresh */
        }
      }
    }),
  );
  files.sort((a, b) => a.relative.localeCompare(b.relative));
  return {
    repository: true,
    branch: branchText.trim() || null,
    head: headText.trim() || null,
    files,
    additions: files.reduce((sum, file) => sum + file.additions, 0),
    deletions: files.reduce((sum, file) => sum + file.deletions, 0),
    remote: remoteText.trim() ? "origin" : null,
    upstream: upstreamText.trim() || null,
    defaultBranch: defaultBranch || null,
    ahead: ahead || 0,
    behind: behind || 0,
    aheadOfDefault,
    headPushed,
    conflicts,
    operation,
  };
}

async function gitBlob(root: string, spec: string) {
  try {
    const text = await git(root, ["show", spec], MAX_FILE + 1024);
    return { text, binary: text.includes("\0"), tooLarge: false };
  } catch (error) {
    return {
      text: "",
      binary: false,
      tooLarge: String(error).includes("maxBuffer"),
    };
  }
}

export async function hostFileDiff(
  root: string,
  input: unknown,
  staged: boolean,
): Promise<GitFileDiff> {
  const path = await safeGitPath(root, input);
  const relativePath = relative(root, path).split(sep).join("/");
  const file = (await hostChangedEntries(root, [relativePath])).find(
    (entry) => entry.relative === relativePath,
  );
  if (!file) throw new Error("File has no uncommitted changes");
  const prefix = (await git(root, ["rev-parse", "--show-prefix"])).trim();
  const repositoryPath = `${prefix}${relativePath}`;
  const originalPath = staged
    ? ((file as ChangedEntry).originalPath ?? repositoryPath)
    : repositoryPath;
  const original = await gitBlob(root, `${staged ? "HEAD" : ""}:${originalPath}`);
  const current = staged
    ? await gitBlob(root, `:${repositoryPath}`)
    : await readHostFile(root, relativePath).then(
        (text) => ({ text, binary: false, tooLarge: false }),
        (error) => {
          if (file.status === "deleted") return { text: "", binary: false, tooLarge: false };
          if (String(error).includes("too large"))
            return { text: "", binary: false, tooLarge: true };
          if (String(error).includes("Binary file"))
            return { text: "", binary: true, tooLarge: false };
          throw error;
        },
      );
  return {
    path: relativePath,
    relative: relativePath,
    status: file.status,
    original: original.text,
    current: current.text,
    binary: original.binary || current.binary,
    tooLarge: original.tooLarge || current.tooLarge,
  };
}

async function retryIndexLock<T>(run: () => Promise<T>): Promise<T> {
  const deadline = Date.now() + 2_000;
  for (;;) {
    try {
      return await run();
    } catch (error) {
      const message = (error as { stderr?: string }).stderr || String(error);
      if (
        !(message.includes("index.lock") && message.includes("File exists")) ||
        Date.now() >= deadline
      )
        throw error;
      await delay(100);
    }
  }
}

async function acquireGitIndexLock(path: string) {
  const deadline = Date.now() + 2_000;
  for (;;) {
    try {
      return await open(path, "wx");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST" || Date.now() >= deadline) throw error;
      await delay(100);
    }
  }
}

export async function hostGitAction(
  root: string,
  action: unknown,
  input?: unknown,
  message?: unknown,
  contents?: unknown,
  expectedOriginal?: unknown,
) {
  const run = () => {
    const execute = () =>
      runHostGitAction(root, action, input, message, contents, expectedOriginal);
    // Only retry index edits. A commit hook or network operation can report a
    // lock error after other side effects, so replaying those is unsafe.
    return ["stage", "unstage", "stageFiles", "unstageFiles", "stageAll", "unstageAll"].includes(
      String(action),
    )
      ? retryIndexLock(execute)
      : execute();
  };
  return withHostGitMutation(root, async () => {
    try {
      return await run();
    } finally {
      invalidateHostFilePaths(root);
      invalidateHostGitIndex(root);
    }
  });
}

async function runHostGitAction(
  root: string,
  action: unknown,
  input?: unknown,
  message?: unknown,
  contents?: unknown,
  expectedOriginal?: unknown,
) {
  const discard = async (file: GitChangedFile) => {
    const path = relative(root, await safeGitPath(root, file.relative));
    if (file.status === "untracked") await rm(resolve(root, path));
    else await git(root, ["restore", "--worktree", "--", path]);
  };
  switch (action) {
    case "stageContents": {
      const path = relative(root, await safeGitPath(root, input))
        .split(sep)
        .join("/");
      if (typeof contents !== "string" || Buffer.byteLength(contents) > MAX_FILE)
        throw new Error("File too large or invalid");
      if (expectedOriginal !== undefined && typeof expectedOriginal !== "string")
        throw new Error("Invalid index base");
      const indexPath = resolve(
        root,
        (await git(root, ["rev-parse", "--git-path", "index"])).trim(),
      );
      const lockPath = `${indexPath}.lock`;
      // Own Git's real lock from comparison through publication, including external clients.
      const lock = await acquireGitIndexLock(lockPath);
      let published = false;
      try {
        const index = await readFile(indexPath).catch((error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") return null;
          throw error;
        });
        if (index) await lock.writeFile(index);
        await lock.close();
        const staged = await git(root, ["ls-files", "--stage", "--", path]);
        const expectedHash =
          typeof expectedOriginal === "string"
            ? (
                await gitWithInput(
                  root,
                  ["hash-object", "--path", path, "--stdin"],
                  expectedOriginal,
                )
              ).trim()
            : null;
        const entry = staged.match(/^([0-7]{6}) ([a-f0-9]+) 0\t/);
        if (
          expectedHash !== null &&
          ((staged && !entry) || (entry ? entry[2] !== expectedHash : expectedOriginal !== ""))
        )
          throw new Error("The Git index changed. Refresh the diff before staging this hunk.");
        const hash = (
          await gitWithInput(root, ["hash-object", "-w", "--path", path, "--stdin"], contents)
        ).trim();
        const mode = entry?.[1] ?? "100644";
        if (!index)
          await exec("git", ["read-tree", "--empty"], {
            cwd: root,
            windowsHide: true,
            timeout: 10_000,
            env: { ...process.env, GIT_INDEX_FILE: lockPath, GIT_TERMINAL_PROMPT: "0" },
          });
        await exec("git", ["update-index", "--add", "--cacheinfo", mode, hash, path], {
          cwd: root,
          windowsHide: true,
          timeout: 10_000,
          env: { ...process.env, GIT_INDEX_FILE: lockPath, GIT_TERMINAL_PROMPT: "0" },
        });
        await rename(lockPath, indexPath);
        published = true;
      } finally {
        await lock.close().catch(() => {});
        if (!published) await rm(lockPath, { force: true });
      }
      return;
    }
    case "stageFiles":
    case "unstageFiles":
    case "stage":
    case "unstage": {
      const bulk = action === "stageFiles" || action === "unstageFiles";
      const staging = action === "stage" || action === "stageFiles";
      const inputs = bulk ? input : [input];
      if (!Array.isArray(inputs) || inputs.length > 100_000) throw new Error("Invalid Git paths");
      if (!inputs.length) return;
      // Validate the complete selection before touching the index.
      const paths: string[] = [];
      for (const value of inputs)
        paths.push(
          relative(root, await safeGitPath(root, value))
            .split(sep)
            .join("/"),
        );
      const hasHead =
        !staging &&
        (await git(root, ["rev-parse", "--verify", "HEAD"]).then(
          () => true,
          () => false,
        ));
      if (hasHead) {
        const renames = (await readChangedEntries(root)).filter(
          (entry) =>
            entry.stagedRename &&
            paths.some(
              (selected) =>
                entry.relative === selected || entry.relative.startsWith(`${selected}/`),
            ),
        );
        if (renames.length) {
          // Both names are repository-relative. Relating them directly avoids
          // mixing a lexical project alias with Git's canonical checkout path
          // (for example /var versus /private/var on macOS).
          const prefix = (await git(root, ["rev-parse", "--show-prefix"])).trim();
          for (const entry of renames) {
            paths.push(relative(prefix || ".", entry.originalPath!));
          }
        }
      }
      await gitWithInput(
        root,
        staging
          ? ["add", "--pathspec-from-file=-", "--pathspec-file-nul"]
          : hasHead
            ? ["restore", "--staged", "--pathspec-from-file=-", "--pathspec-file-nul"]
            : ["rm", "--cached", "-r", "-f", "--pathspec-from-file=-", "--pathspec-file-nul"],
        [...new Set(paths)].join("\0") + "\0",
        120_000,
      );
      return;
    }
    case "stageAll": {
      // Staging conflicted files would mark them resolved with their markers
      // still in, and pathspec excludes do not hold back unmerged paths: with
      // conflicts, name the other files instead.
      if (!(await hostUnmerged(root)).length) {
        await git(root, ["add", "-A", "--", "."]);
        return;
      }
      const others = (await hostChangedEntries(root)).map((file) => file.relative);
      if (others.length)
        await gitWithInput(
          root,
          ["add", "-A", "--pathspec-from-file=-", "--pathspec-file-nul"],
          others.join("\0") + "\0",
          120_000,
        );
      return;
    }
    case "unstageAll": {
      const hasHead = await git(root, ["rev-parse", "--verify", "HEAD"]).then(
        () => true,
        () => false,
      );
      if (hasHead) await git(root, ["restore", "--staged", "--", "."]);
      else if ((await git(root, ["ls-files", "--cached"])).trim())
        await git(root, ["rm", "--cached", "-r", "-f", "--", "."]);
      return;
    }
    case "discard": {
      const path = relative(root, await safeGitPath(root, input))
        .split(sep)
        .join("/");
      const file = (await hostChangedEntries(root, [path])).find(
        (entry) => entry.relative === path && entry.unstaged,
      );
      if (!file) throw new Error("File has no changes to discard");
      await discard(file);
      return;
    }
    case "discardFiles":
    case "discardAll": {
      let selected: Set<string> | undefined;
      if (action === "discardFiles") {
        if (!Array.isArray(input) || input.length > 100_000) throw new Error("Invalid Git paths");
        selected = new Set<string>();
        for (const value of input)
          selected.add(
            relative(root, await safeGitPath(root, value))
              .split(sep)
              .join("/"),
          );
        if (!selected.size) return;
      }
      const files = (await hostChangedEntries(root)).filter(
        (file) => file.unstaged && (!selected || selected.has(file.relative)),
      );
      if (selected && files.length !== selected.size)
        throw new Error("Selected files changed; refresh before discarding");
      const tracked: string[] = [];
      const untracked: string[] = [];
      // Validate every target before the first write, and restore tracked files
      // before deleting untracked files so a failed Git operation stops deletion.
      for (const file of files) {
        const path = await safeGitPath(root, file.relative);
        if (file.status === "untracked") untracked.push(path);
        else tracked.push(relative(root, path).split(sep).join("/"));
      }
      if (tracked.length)
        await gitWithInput(
          root,
          ["restore", "--worktree", "--pathspec-from-file=-", "--pathspec-file-nul"],
          tracked.join("\0") + "\0",
          120_000,
        );
      for (const path of untracked) await rm(path);
      return;
    }
    case "commit": {
      if (typeof message !== "string" || !message.trim() || message.length > 100_000)
        throw new Error("Enter a commit message");
      const unresolved = await hostUnmerged(root);
      if (unresolved.length) throw new Error(unmergedMessage(unresolved));
      await git(root, ["commit", "-m", message], 1024 * 1024);
      return;
    }
    case "push": {
      const hasUpstream = await git(root, ["rev-parse", "--abbrev-ref", "@{upstream}"]).then(
        () => true,
        () => false,
      );
      let args = ["push"];
      if (!hasUpstream) {
        const remotes = (await git(root, ["remote"])).trim().split(/\r?\n/).filter(Boolean);
        const remote = remotes.includes("origin") ? "origin" : remotes[0];
        if (!remote) throw new Error("No git remote to push to");
        args = ["push", "-u", remote, "HEAD"];
      }
      await git(root, args, 4 * 1024 * 1024, 120_000);
      return;
    }
    case "createPr": {
      const output = await exec("gh", ["pr", "create", "--fill"], {
        cwd: root,
        timeout: 30_000,
        maxBuffer: 1024 * 1024,
        env: {
          ...process.env,
          GH_PROMPT_DISABLED: "1",
          GIT_TERMINAL_PROMPT: "0",
        },
      });
      return output.stdout.trim();
    }
    default:
      throw new Error("Unsupported Git action");
  }
}
