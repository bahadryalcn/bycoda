import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Private plumbing for a bycoda-owned bare repository. Never points at a user repository:
 * every call runs with an explicit GIT_DIR, no work tree, no inherited GIT_* variables,
 * no system/global config, and cwd in the OS temp directory. */
export type GitObjectStoreOptions = { git: string; gitDir: string; timeoutMs: number };
export type GitObjectInfo = { oid: string; type: string; size: number };
export type GitHead = { commit: string; tree: string; message: string };
export type GitTreeChange = { path: string; oid: string | null };

type RunOptions = {
  input?: Buffer | string | (Buffer | string)[];
  index?: string;
  maxBytes?: number;
  timeoutMs?: number;
  env?: Record<string, string>;
};
type RunResult = { code: number | null; stdout: Buffer; stderr: string };

const STDERR_LIMIT = 64 * 1024;
const OID = /^[a-f0-9]{40}$/;
const IDENTITY = {
  GIT_AUTHOR_NAME: "bycoda",
  GIT_AUTHOR_EMAIL: "native-buffer@bycoda.invalid",
  GIT_COMMITTER_NAME: "bycoda",
  GIT_COMMITTER_EMAIL: "native-buffer@bycoda.invalid",
};

/** Git blob id computed in-process (repositories are initialized with sha1). */
export const gitBlobOid = (bytes: Buffer) =>
  createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");

function environment(gitDir: string, extra: Record<string, string>) {
  const env = { ...process.env };
  for (const name of Object.keys(env)) if (name.toUpperCase().startsWith("GIT_")) delete env[name];
  return {
    ...env,
    GIT_DIR: gitDir,
    GIT_TERMINAL_PROMPT: "0",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
    LC_ALL: "C.UTF-8",
    ...extra,
  };
}

export function createGitObjectStore(options: GitObjectStoreOptions) {
  const { git, gitDir, timeoutMs } = options;

  /** Runs git without a shell; rejects on spawn failure, deadline or output overflow. */
  function run(args: string[], opts: RunOptions = {}): Promise<RunResult> {
    const deadline = opts.timeoutMs ?? timeoutMs,
      maxBytes = opts.maxBytes ?? 16 * 1024 * 1024;
    return new Promise<RunResult>((resolve, reject) => {
      let settled = false;
      const child = spawn(git, args, {
        cwd: tmpdir(),
        env: environment(gitDir, {
          ...(opts.index ? { GIT_INDEX_FILE: opts.index } : {}),
          ...opts.env,
        }),
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      });
      const stdout: Buffer[] = [],
        stderr: Buffer[] = [];
      let outBytes = 0,
        errBytes = 0;
      const finish = (error: Error | null, code: number | null = null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) {
          child.kill();
          reject(error);
          return;
        }
        // Lossy decoding: invalid UTF-8 in diagnostics never ends the reader.
        resolve({ code, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr).toString() });
      };
      const timer = setTimeout(
        () => finish(new Error(`git ${args[0]} exceeded its ${deadline} ms deadline`)),
        deadline,
      );
      child.on("error", (error) => finish(error));
      child.stdout.on("data", (chunk: Buffer) => {
        outBytes += chunk.length;
        if (outBytes > maxBytes) finish(new Error(`git ${args[0]} output exceeded its limit`));
        else stdout.push(chunk);
      });
      child.stderr.on("data", (chunk: Buffer) => {
        if (errBytes < STDERR_LIMIT) stderr.push(chunk);
        errBytes += chunk.length;
      });
      child.on("close", (code) => finish(null, code));
      // EPIPE when git exits early is reported through the exit code instead.
      child.stdin.on("error", () => {});
      const input = opts.input === undefined ? [] : [opts.input].flat();
      for (const piece of input) child.stdin.write(piece);
      child.stdin.end();
    });
  }
  async function exec(args: string[], opts?: RunOptions): Promise<Buffer> {
    const result = await run(args, opts);
    if (result.code !== 0)
      throw new Error(
        `git ${args[0]} failed (${result.code}): ${result.stderr.trim().slice(0, 500)}`,
      );
    return result.stdout;
  }
  const text = async (args: string[], opts?: RunOptions) =>
    (await exec(args, opts)).toString().trim();

  function parseHeader(line: string): GitObjectInfo | null {
    if (line.endsWith(" missing") || line.endsWith(" ambiguous")) return null;
    const [oid, type, size] = line.split(" ");
    const value = Number(size);
    if (!OID.test(oid) || !type || !Number.isSafeInteger(value) || value < 0)
      throw new Error("git cat-file returned an unexpected header");
    return { oid, type, size: value };
  }
  /** One process for many `<rev>:<path>` lookups; null for missing objects. */
  async function batchCheck(specs: string[]): Promise<(GitObjectInfo | null)[]> {
    if (!specs.length) return [];
    if (specs.some((spec) => /[\r\n]/.test(spec))) throw new Error("Invalid git object name");
    const lines = (await exec(["cat-file", "--batch-check"], { input: specs.join("\n") + "\n" }))
      .toString()
      .split("\n")
      .filter(Boolean);
    if (lines.length !== specs.length) throw new Error("git cat-file returned a short answer");
    return lines.map(parseHeader);
  }
  /** Reads many objects in one process; the total output is bounded by maxBytes. */
  async function catBatch(specs: string[], maxBytes: number): Promise<(Buffer | null)[]> {
    if (!specs.length) return [];
    if (specs.some((spec) => /[\r\n]/.test(spec))) throw new Error("Invalid git object name");
    const raw = await exec(["cat-file", "--batch"], {
      input: specs.join("\n") + "\n",
      maxBytes: maxBytes + specs.length * 128,
    });
    const values: (Buffer | null)[] = [];
    let offset = 0;
    for (let index = 0; index < specs.length; index++) {
      const end = raw.indexOf(10, offset);
      if (end < 0) throw new Error("git cat-file returned a short answer");
      const header = parseHeader(raw.subarray(offset, end).toString());
      offset = end + 1;
      if (!header) {
        values.push(null);
        continue;
      }
      if (header.type !== "blob" || offset + header.size + 1 > raw.length)
        throw new Error("git cat-file returned an unexpected object");
      values.push(Buffer.from(raw.subarray(offset, offset + header.size)));
      offset += header.size + 1;
    }
    return values;
  }
  /** Reads one blob by id with a byte bound; null when the object does not exist. */
  async function readBlob(spec: string, limit: number): Promise<Buffer | null> {
    const [info] = await batchCheck([spec]);
    // A directory is not a readable artifact, as in the SQL store.
    if (!info || info.type === "tree") return null;
    if (info.type !== "blob") throw new Error("Native buffer git entry is not a file");
    if (info.size > limit) throw new Error("Native buffer git entry exceeds the read limit");
    const bytes = await exec(["cat-file", "blob", info.oid], { maxBytes: limit });
    if (bytes.length !== info.size || gitBlobOid(bytes) !== info.oid)
      throw new Error("Native buffer git object is corrupt");
    return bytes;
  }
  /** Writes every blob in one fast-import process (small sets stay loose objects). */
  async function writeBlobs(blobs: Buffer[]): Promise<string[]> {
    if (!blobs.length) return [];
    const input: (Buffer | string)[] = [];
    blobs.forEach((bytes, index) => {
      input.push(`blob\nmark :${index + 1}\ndata ${bytes.length}\n`, bytes, "\n");
    });
    blobs.forEach((_, index) => input.push(`get-mark :${index + 1}\n`));
    input.push("done\n");
    const oids = (await exec(["fast-import", "--done", "--quiet"], { input }))
      .toString()
      .split("\n")
      .filter(Boolean);
    if (oids.length !== blobs.length || oids.some((oid, index) => oid !== gitBlobOid(blobs[index])))
      throw new Error("git fast-import stored unexpected blob ids");
    return oids;
  }
  /** Builds a tree from base plus changes in a private index; nothing is materialized. */
  async function buildTree(base: string | null, changes: GitTreeChange[]): Promise<string> {
    const index = join(gitDir, `bycoda-index-${randomUUID()}`);
    try {
      await exec(base ? ["read-tree", base] : ["read-tree", "--empty"], { index });
      if (changes.length) {
        const lines = changes.map(({ path, oid }) => {
          if (/[\t\r\n\0]/.test(path) || (oid !== null && !OID.test(oid)))
            throw new Error("Invalid git tree change");
          return oid ? `100644 ${oid}\t${path}\n` : `0 ${"0".repeat(40)}\t${path}\n`;
        });
        await exec(["update-index", "--index-info"], { index, input: lines });
      }
      const tree = await text(["write-tree"], { index });
      if (!OID.test(tree)) throw new Error("git write-tree returned an unexpected id");
      return tree;
    } finally {
      await rm(index, { force: true });
      await rm(index + ".lock", { force: true });
    }
  }
  /** Lists full paths below `paths` (files only), recursively. */
  async function listFiles(tree: string, paths: string[]): Promise<string[]> {
    const names: string[] = [];
    for (let offset = 0; offset < paths.length; offset += 64) {
      const raw = await exec(
        ["ls-tree", "-r", "-z", "--name-only", tree, "--", ...paths.slice(offset, offset + 64)],
        { maxBytes: 64 * 1024 * 1024 },
      );
      names.push(...raw.toString().split("\0").filter(Boolean));
    }
    return names;
  }
  /** Direct children of a directory in tree order. */
  async function listDirectory(
    tree: string,
    directory: string,
  ): Promise<{ name: string; isDirectory: boolean }[]> {
    const raw = await exec(["ls-tree", "-z", tree, "--", directory + "/"], {
      maxBytes: 64 * 1024 * 1024,
    });
    return raw
      .toString()
      .split("\0")
      .filter(Boolean)
      .map((line) => {
        const tab = line.indexOf("\t"),
          [, type] = line.slice(0, tab).split(" "),
          path = line.slice(tab + 1);
        if (tab < 0 || !path.startsWith(directory + "/"))
          throw new Error("Unexpected ls-tree line");
        return { name: path.slice(directory.length + 1), isDirectory: type === "tree" };
      });
  }
  async function readHead(ref: string): Promise<GitHead | null> {
    const raw = await exec(["cat-file", "--batch"], { input: ref + "\n", maxBytes: 1024 * 1024 });
    const end = raw.indexOf(10);
    const header = parseHeader(raw.subarray(0, end < 0 ? raw.length : end).toString());
    if (!header) return null;
    if (header.type !== "commit") throw new Error("Native buffer git ref is not a commit");
    const body = raw.subarray(end + 1, end + 1 + header.size).toString(),
      split = body.indexOf("\n\n"),
      tree = /^tree ([a-f0-9]{40})$/m.exec(body.slice(0, split));
    if (split < 0 || !tree) throw new Error("Native buffer git commit is corrupt");
    return { commit: header.oid, tree: tree[1], message: body.slice(split + 2) };
  }
  async function commitTree(tree: string, messages: string[]): Promise<string> {
    const commit = await text(["commit-tree", tree, ...messages.flatMap((m) => ["-m", m])], {
      env: IDENTITY,
    });
    if (!OID.test(commit)) throw new Error("git commit-tree returned an unexpected id");
    return commit;
  }
  /** Compare-and-swap; old null means "must not exist". False when another writer won. */
  async function updateRef(ref: string, next: string, old: string | null): Promise<boolean> {
    const result = await run(["update-ref", ref, next, old ?? ""]);
    return result.code === 0;
  }
  return {
    run,
    exec,
    text,
    batchCheck,
    catBatch,
    readBlob,
    writeBlobs,
    buildTree,
    listFiles,
    listDirectory,
    readHead,
    commitTree,
    updateRef,
  };
}
export type GitObjectStore = ReturnType<typeof createGitObjectStore>;
