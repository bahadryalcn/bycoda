import { randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, readFile, readdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve, relative } from "node:path";
import { execFileAsync as exec } from "../src/shared/lib/processExecution.node";
import type { CheckpointFileDiff, CheckpointStatus } from "../src/features/sessions/model/checkpoint";
import { safeGitPath } from "./workspace";
import { CheckpointLeases } from "./checkpoint-leases";

type Blob = { oid: string; mode: string } | null;
type Pair = { before: Blob; after: Blob; exact: boolean; rawBefore?: string; rawAfter?: string; modeBefore?: number };
type Record = {
  cwd: string; head: string | null; active?: { id: string; tree: string; dirty: { [path: string]: string }; modes?: { [path: string]: number }; claimed?: string[] };
  shared: boolean; error?: string; noGit?: boolean; files: { [path: string]: Pair };
};
const MAX_FILES = 500;
const MAX_BYTES = 8 * 1024 * 1024;
const id = (v: unknown) => {
  if (typeof v !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(v)) throw new Error("Invalid checkpoint ID");
  return v;
};
const same = (a: Blob, b: Blob) => a?.oid === b?.oid && a?.mode === b?.mode;
const errorText = (e: unknown) => e instanceof Error ? e.message : String(e);
const overlap = (a: string, b: string) => {
  const normalize = (p: string) => {
    const s = p.replace(/\\/g, "/").replace(/^\/\/\?\//, "").replace(/\/$/, "");
    return process.platform === "win32" ? s.toLowerCase() : s;
  };
  a = normalize(a); b = normalize(b);
  return a === b || a.startsWith(b + "/") || b.startsWith(a + "/");
};
async function git(cwd: string, args: string[], index?: string): Promise<Buffer> {
  const result = await exec("git", ["--no-pager", ...args], { cwd, encoding: "buffer", windowsHide: true, timeout: 60_000,
    maxBuffer: 20 * 1024 * 1024, env: { ...process.env, GIT_LITERAL_PATHSPECS: "1", GIT_OPTIONAL_LOCKS: "0",
      GIT_TERMINAL_PROMPT: "0", ...(index ? { GIT_INDEX_FILE: index } : {}) } });
  return result.stdout as Buffer;
}
const head = (cwd: string) => git(cwd, ["rev-parse", "--verify", "HEAD"]).then(v => v.toString().trim(), () => null);
async function hasGit(cwd: string) {
  if (process.env.GIT_DIR) return true;
  for (let path = cwd; ; path = dirname(path)) {
    const marker = await lstat(join(path, ".git")).catch((e: NodeJS.ErrnoException) => {
      if (e.code === "ENOENT") return undefined; throw e;
    });
    if (marker) return true;
    if (dirname(path) === path) return false;
  }
}

/** Persistent session-owned snapshots. A serialized gate covers capture/undo races. */
export class HostCheckpoints {
  private tail: Promise<unknown> = Promise.resolve();
  private leases: CheckpointLeases;
  constructor(private root: string, leaseRoot = join(root, ".active-leases")) { this.leases = new CheckpointLeases(leaseRoot); }
  private queue<T>(op: () => Promise<T>): Promise<T> {
    const result = this.tail.then(op, op); this.tail = result.catch(() => undefined); return result;
  }
  private dir(session: string) { return join(this.root, id(session)); }
  private async load(session: string): Promise<Record | undefined> {
    try {
      const record = JSON.parse(await readFile(join(this.dir(session), "manifest.json"), "utf8")) as Record;
      record.files = Object.assign(Object.create(null), record.files);
      if (record.active) {
        record.active.dirty = Object.assign(Object.create(null), record.active.dirty);
        record.active.modes = Object.assign(Object.create(null), record.active.modes);
      }
      return record;
    }
    catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return; throw e; }
  }
  private async save(session: string, record: Record) {
    const dir = this.dir(session); await mkdir(dir, { recursive: true });
    const tmp = join(dir, "manifest.json.tmp"); await writeFile(tmp, JSON.stringify(record));
    await rename(tmp, join(dir, "manifest.json"));
  }
  private async active(session: string, cwd: string) {
    const list: [string, Record][] = [];
    const entries = await readdir(this.root).catch((e: NodeJS.ErrnoException) => {
      if (e.code === "ENOENT") return []; throw e;
    });
    for (const other of entries) {
      if (other === session || !/^[A-Za-z0-9_-]{1,128}$/.test(other)) continue;
      const record = await this.load(other);
      if (record?.active && overlap(cwd, record.cwd)) list.push([other, record]);
    }
    return list;
  }
  private async snapshot(cwd: string, session: string, turn: string, phase: string) {
    if ((await git(cwd, ["config", "--bool", "core.sparseCheckout"]).catch(() => Buffer.alloc(0))).toString().trim() === "true")
      throw new Error("Workspace checkpoints are unavailable for sparse checkouts");
    await mkdir(this.dir(session), { recursive: true });
    const index = join(this.dir(session), `index-${randomUUID()}`);
    try {
      await git(cwd, ["read-tree", await head(cwd) ? "HEAD" : "--empty"], index);
      await git(cwd, ["add", "-A", "--", "."], index);
      const tree = (await git(cwd, ["write-tree"], index)).toString().trim();
      await git(cwd, ["update-ref", `refs/bycoda/checkpoints/${session}/${turn}/${phase}`, tree]);
      return tree;
    } finally { await rm(index, { force: true }); await rm(index + ".lock", { force: true }); }
  }
  private async raw(cwd: string, path: string): Promise<string | undefined> {
    const abs = await safeGitPath(cwd, path);
    try {
      const meta = await lstat(abs);
      if (!meta.isFile() || meta.isSymbolicLink()) throw new Error("Unsupported checkpoint file");
      if (meta.size > MAX_BYTES) throw new Error("Checkpoint file is too large");
      return (await readFile(abs)).toString("base64");
    } catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return; throw e; }
  }
  begin(session: string, cwd: string, turn: string) {
    id(session); id(turn);
    return this.queue(async () => {
      cwd = await realpath(cwd);
      const old = await this.load(session);
      if (old?.active?.id === turn && old.cwd === cwd) {
        if (old.error) throw new Error(old.error);
        return;
      }
      if (old?.active) await this.finishNow(session, old.cwd, old.active.id, true).catch(() => undefined);
      const shared = await this.leases.publish(session, turn, cwd).catch((e) => { throw new Error(`checkpoint-coordination: ${errorText(e)}`); });
      const previous = await this.load(session);
      if (previous?.cwd === cwd) await this.retireResolved(session, previous);
      const isGit = await hasGit(cwd);
      const owned = previous?.cwd === cwd && Object.keys(previous.files).length > 0;
      const record: Record = { cwd, head: owned ? previous.head : isGit ? await head(cwd) : null, noGit: !isGit, shared: shared || (owned ? previous.shared : false),
        files: owned ? previous.files : Object.create(null), active: { id: turn, tree: "", dirty: Object.create(null), modes: Object.create(null) } };
      await this.save(session, record);
      if (!isGit) return;
      try {
        // Non-Git folders retain structured-edit review; do not manufacture a tree.
        for (const [other, active] of await this.active(session, cwd)) { record.shared = true; active.shared = true; await this.save(other, active); }
        const dirty = (await git(cwd, ["diff", "--relative", "--name-only", "-z", "HEAD", "--", "."]).catch(() => Buffer.alloc(0))).toString().split("\0").filter(Boolean);
        const untracked = (await git(cwd, ["ls-files", "--others", "--exclude-standard", "-z"])).toString().split("\0").filter(Boolean);
        const staged = (await git(cwd, ["diff", "--cached", "--relative", "--name-only", "-z", "--", "."])).toString().split("\0").filter(Boolean);
        const paths = [...new Set([...dirty, ...untracked, ...staged])];
        if (paths.length > MAX_FILES) throw new Error("Too many dirty files for checkpoint");
        let bytes = 0;
        for (const path of paths) {
          const raw = await this.raw(cwd, path);
          if (raw !== undefined) {
            bytes += raw.length; if (bytes > 64 * 1024 * 1024) throw new Error("Checkpoint baseline is too large");
            record.active!.dirty[path] = raw;
            record.active!.modes![path] = (await lstat(await safeGitPath(cwd, path))).mode & 0o777;
          }
        }
        record.active!.tree = await this.snapshot(cwd, session, turn, "before");
      } catch (e) {
        record.error = errorText(e);
      }
      await this.save(session, record);
      if (record.error) throw new Error(record.error);
    });
  }
  finish(session: string, cwd: string, turn: string, interrupted = false) {
    return this.queue(() => this.finishNow(session, cwd, turn, interrupted));
  }
  claim(session: string, cwd: string, turn: string, paths: string[]) {
    return this.queue(async () => {
      const record = await this.load(session);
      if (!record?.active || record.active.id !== turn || record.cwd !== await realpath(cwd)) return;
      const claimed = new Set(record.active.claimed);
      for (const path of paths) {
        const absolute = await safeGitPath(record.cwd, path);
        claimed.add(relative(record.cwd, absolute).replace(/\\/g, "/"));
      }
      record.active.claimed = [...claimed];
      await this.save(session, record);
    });
  }
  private async finishNow(session: string, cwd: string, turn: string, interrupted: boolean) {
    const record = await this.load(session);
    if (!record?.active || record.active.id !== turn || record.cwd !== await realpath(cwd)) { await this.leases.release(session, turn); return; }
    const ambiguous = await this.leases.shared(session, turn);
    record.shared ||= ambiguous;
    record.shared ||= interrupted;
    try {
      if (record.noGit) {
        record.shared ||= await this.leases.shared(session, turn);
        delete record.active; await this.save(session, record); await this.leases.release(session, turn); return;
      }
      if (!record.active.tree) throw new Error(record.error || "Missing turn baseline");
      const after = await this.snapshot(record.cwd, session, turn, "after");
      const raw = (await git(record.cwd, ["diff", "--relative", "--raw", "--no-abbrev", "--no-renames", "--no-ext-diff", "--no-textconv", "-z", record.active.tree, after, "--", "."])).toString().split("\0");
      if (raw.length > MAX_FILES * 2 + 1) throw new Error("Too many changed files for checkpoint");
      for (let i = 0; i + 1 < raw.length; i += 2) {
        const fields = raw[i].replace(/^:/, "").split(" "); const path = raw[i + 1];
        if ((ambiguous || record.active.claimed?.length) && !record.active.claimed?.includes(path)) continue;
        await safeGitPath(record.cwd, path);
        const blob = (mode: string, oid: string): Blob => mode === "000000" ? null : { mode, oid };
        const before = blob(fields[0], fields[2]), next = blob(fields[1], fields[3]);
        const old = record.files[path];
        record.files[path] = { before: old ? old.before : before, after: next,
          modeBefore: old ? old.modeBefore : record.active.modes?.[path] ?? (before?.mode === "100755" ? 0o755 : 0o644),
          rawBefore: old ? old.rawBefore : record.active.dirty[path] ?? (await this.contents(record.cwd, path, before)).toString("base64"), rawAfter: await this.raw(record.cwd, path),
          exact: !old || old.exact && same(old.after, before) };
        if (same(record.files[path].before, next)) delete record.files[path];
      }
      if (Object.keys(record.files).length > MAX_FILES) throw new Error("Too many session-owned files for checkpoint");
      delete record.error;
    } catch (e) { record.error = errorText(e); }
    record.shared ||= await this.leases.shared(session, turn);
    delete record.active;
    await this.save(session, record);
    await this.leases.release(session, turn);
    if (record.error) throw new Error(record.error);
  }
  private async matching(session: string, cwd: string) {
    const record = await this.load(session);
    if (!record || record.cwd !== await realpath(cwd)) return;
    if (record.error) throw new Error(`Workspace checkpoint failed: ${record.error}`);
    if (record.active) throw new Error("Workspace checkpoint is still recording this turn");
    await this.retireResolved(session, record);
    return record;
  }
  private async retireResolved(session: string, record: Record) {
    if (record.noGit || record.active || !Object.keys(record.files).length) return;
    const currentHead = await head(record.cwd);
    if (!currentHead || currentHead === record.head) return;
    // Include staged and unstaged changes. Only checkpoint membership changes;
    // the real index and working files remain untouched.
    const pending = new Set((await git(record.cwd, ["diff", "--no-ext-diff", "--no-textconv", "--no-renames", "--relative", "--name-only", "-z", currentHead, "--", "."]))
      .toString().split("\0").filter(Boolean));
    for (const path of (await git(record.cwd, ["ls-files", "--others", "--exclude-standard", "-z", "--", "."])).toString().split("\0").filter(Boolean)) pending.add(path);
    const resolved: string[] = [];
    for (const [path, pair] of Object.entries(record.files)) {
      await safeGitPath(record.cwd, path);
      const entry = (await git(record.cwd, ["ls-tree", "-z", currentHead, "--", path])).toString();
      const fields = entry.split("\t", 1)[0].split(" ");
      const committed: Blob = entry ? { mode: fields[0], oid: fields[2] } : null;
      if (same(pair.after, committed) || (!pending.has(path) && (pair.before || committed))) resolved.push(path);
    }
    if (!resolved.length || await head(record.cwd) !== currentHead) return;
    for (const path of resolved) delete record.files[path];
    await this.save(session, record);
  }
  private async restorable(record: Record, path: string, pair: Pair) {
    if (!pair.exact || [pair.before, pair.after].some(blob => blob && !["100644", "100755"].includes(blob.mode))) return false;
    try {
      const raw = await this.raw(record.cwd, path);
      if (pair.rawAfter !== raw) return false;
      const meta = await lstat(await safeGitPath(record.cwd, path)).catch((e: NodeJS.ErrnoException) => { if (e.code === "ENOENT") return undefined; throw e; });
      const mode = meta ? process.platform !== "win32" && (meta.mode & 0o111) ? "100755" : "100644" : undefined;
      return process.platform === "win32" ? !!meta === !!pair.after : mode === pair.after?.mode;
    } catch { return false; }
  }
  status(session: string, cwd: string): Promise<CheckpointStatus> {
    return this.queue(async () => {
      const record = await this.matching(session, cwd); if (!record) return { files: [] };
      const safe = !record.shared && record.head === await head(record.cwd) && !(await this.active(session, record.cwd)).length && !await this.leases.active(record.cwd);
      const files = await Promise.all(Object.entries(record.files).map(async ([path, pair]) => {
        const diff = await this.diff(record.cwd, path, pair);
        return { path: resolve(record.cwd, path), relative: path, status: !pair.before ? "untracked" : !pair.after ? "deleted" : "modified",
          exact: pair.exact, undoable: safe && await this.restorable(record, path, pair), ...diff.stats };
      }));
      return { files };
    });
  }
  private async contents(cwd: string, path: string, blob: Blob, raw?: string) {
    if (raw !== undefined) return Buffer.from(raw, "base64");
    if (!blob) return Buffer.alloc(0);
    const size = Number((await git(cwd, ["cat-file", "-s", blob.oid])).toString());
    if (size > MAX_BYTES) throw new Error("Checkpoint file is too large");
    // cat-file's filter path is repository-relative, unlike our checkpoint paths.
    const prefix = (await git(cwd, ["rev-parse", "--show-prefix"])).toString().trimEnd();
    return git(cwd, ["cat-file", "--filters", `--path=${prefix}${path}`, blob.oid]);
  }
  private async diff(cwd: string, path: string, pair: Pair) {
    const [original, current] = await Promise.all([this.contents(cwd, path, pair.before, pair.rawBefore), this.contents(cwd, path, pair.after, pair.rawAfter)]);
    const binary = original.includes(0) || current.includes(0);
    // Git computes the actual counts on two private files; no real index is used.
    const scratch = join(this.root, `diff-${randomUUID()}`); await mkdir(scratch, { recursive: true });
    let additions = 0, deletions = 0;
    try {
      await Promise.all([writeFile(join(scratch, "before"), original), writeFile(join(scratch, "after"), current)]);
      const result = await exec("git", ["diff", "--no-index", "--numstat", "--no-ext-diff", "--no-textconv", "--", join(scratch, "before"), join(scratch, "after")], { encoding: "utf8", windowsHide: true }).catch((e: { code?: number; stdout?: string }) => {
        if (e.code === 1) return { stdout: e.stdout ?? "" }; throw e;
      });
      const fields = String(result.stdout).split("\t"); additions = Number(fields[0]) || 0; deletions = Number(fields[1]) || 0;
    } finally { await rm(scratch, { recursive: true, force: true }); }
    return { original, current, binary, stats: { additions: pair.exact && !binary ? additions : 0, deletions: pair.exact && !binary ? deletions : 0 } };
  }
  fileDiff(session: string, cwd: string, path: string): Promise<CheckpointFileDiff> {
    return this.queue(async () => {
      const record = await this.matching(session, cwd); const pair = record?.files[path];
      if (!record || !pair) throw new Error("File has no session checkpoint");
      if (!pair.exact) throw new Error("Exact lines are unavailable because the file changed between this session's edits");
      await safeGitPath(record.cwd, path);
      const diff = await this.diff(record.cwd, path, pair);
      return { path: resolve(record.cwd, path), relative: path, status: !pair.before ? "untracked" : !pair.after ? "deleted" : "modified",
        original: diff.binary ? "" : diff.original.toString(), current: diff.binary ? "" : diff.current.toString(), binary: diff.binary, tooLarge: false };
    });
  }
  change(session: string, cwd: string, path: string | undefined, undo: boolean) {
    return this.queue(async () => {
      const record = await this.matching(session, cwd); if (!record) return;
      const paths = path === undefined ? Object.keys(record.files) : [path];
      if (undo && (record.shared || record.head !== await head(record.cwd) || (await this.active(session, record.cwd)).length || await this.leases.active(record.cwd)))
        throw new Error("Cannot safely undo: HEAD changed or a turn overlaps this checkout");
      const writes: { path: string; abs: string; pair: Pair; bytes: Buffer }[] = [];
      // Validate the whole selection before writing the first file.
      for (const path of paths) {
        const pair = record.files[path]; if (!pair) continue;
        const abs = await safeGitPath(record.cwd, path);
        if (undo) {
          if (!await this.restorable(record, path, pair)) throw new Error(`Cannot safely undo ${path}: it changed outside this session`);
          writes.push({ path, abs, pair, bytes: await this.contents(record.cwd, path, pair.before, pair.rawBefore) });
        }
      }
      for (const write of writes) {
        if (!await this.restorable(record, write.path, write.pair)) throw new Error("File changed while preparing undo");
        if (!write.pair.before) await rm(write.abs, { force: true });
        else {
          await mkdir(dirname(write.abs), { recursive: true }); await writeFile(write.abs, write.bytes);
          if (process.platform !== "win32") await chmod(write.abs, write.pair.modeBefore ?? 0o644);
        }
      }
      for (const path of paths) delete record.files[path];
      if (!Object.keys(record.files).length) { record.shared = false; record.head = await head(record.cwd); }
      await this.save(session, record);
    }).then(() => this.status(session, cwd));
  }
  recover(session: string, cwd: string) {
    return this.queue(async () => { const record = await this.load(session); if (record?.active) await this.finishNow(session, cwd, record.active.id, true); });
  }
}
