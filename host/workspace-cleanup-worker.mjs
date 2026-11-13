import { createHash } from "node:crypto";
import { lstatSync, readdirSync, readFileSync, readlinkSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { parentPort, workerData } from "node:worker_threads";

// Keep boundary handling equivalent to assertNoFollowPath in workspaces/workspace-cleanup-paths.ts.
const ordinary = (p) =>
  process.platform !== "win32"
    ? p
    : (p = p.replaceAll("/", "\\")).startsWith("\\\\?\\UNC\\")
      ? `\\\\${p.slice(8)}`
      : p.replace(/^\\\\\?\\/, "");
const key = (p) => (process.platform === "win32" ? resolve(ordinary(p)).toLowerCase() : resolve(p));
const inside = (root, target) => {
  const rel = relative(root, target);
  return rel !== "" && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
};
function canonical(p) {
  const absolute = resolve(ordinary(p));
  try {
    return ordinary(realpathSync.native(absolute));
  } catch (error) {
    if (error.code !== "ENOENT" || dirname(absolute) === absolute) throw error;
    return join(canonical(dirname(absolute)), basename(absolute));
  }
}
function noFollow(root, target) {
  root = ordinary(root);
  target = ordinary(target);
  if (
    /(^|[\\/])\.{1,2}([\\/]|$)/.test(root) ||
    /(^|[\\/])\.{1,2}([\\/]|$)/.test(target) ||
    !isAbsolute(root) ||
    !isAbsolute(target)
  )
    throw new Error("Cleanup requires normalized absolute paths without dot segments.");
  const boundary = join(canonical(dirname(root)), basename(root));
  const within = (base) => key(base) === key(target) || inside(base, resolve(target));
  const base = within(resolve(root)) ? resolve(root) : boundary;
  if (!within(base)) throw new Error("Cleanup path is outside its absolute managed root.");
  let current = boundary;
  for (const part of ["", ...relative(base, resolve(target)).split(sep).filter(Boolean)]) {
    if (part) current = join(current, part);
    const info = lstatSync(current, { throwIfNoEntry: false });
    if (info?.isSymbolicLink())
      throw new Error("Cleanup cannot follow a reparse point or symbolic link.");
    if (info && !info.isDirectory()) throw new Error("Cleanup path ancestor is not a directory.");
  }
}
try {
  const { path, files, ignored, index, head, branch, status, detachedLinks } = workerData;
  const detached = new Map(detachedLinks);
  // Ignored entries are often gigabytes of build output. Like Git's own stat check, their
  // size and modification time detect a change without reading every byte; preservation
  // still copies them whole.
  const privateFiles = new Set();
  const addPrivateFiles = (file) => {
    const full = resolve(path, file);
    if (!inside(path, full)) throw new Error("Unsafe ignored source path.");
    const info = lstatSync(full);
    if (info.isDirectory())
      for (const name of readdirSync(full)) {
        if (name === ".git")
          throw new Error("Nested repository requires private recovery support.");
        if (name !== "node_modules") addPrivateFiles(join(file, name));
      }
    else {
      files.push(file);
      privateFiles.add(file);
    }
  };
  for (const file of ignored) addPrivateFiles(file);
  const hash = createHash("sha256").update(head).update(branch).update(status);
  if (lstatSync(index, { throwIfNoEntry: false })) hash.update(readFileSync(index));
  for (const file of [...new Set(files)].sort()) {
    const full = resolve(path, file);
    if (!inside(path, full)) throw new Error("Unsafe source path.");
    noFollow(path, dirname(full) === path ? join(path, "__validation__") : dirname(full));
    const info = lstatSync(full, { throwIfNoEntry: false });
    hash.update(file).update("\0");
    if (info?.isSymbolicLink()) hash.update(readlinkSync(full));
    else if (info?.isFile() && privateFiles.has(file))
      hash.update(`private:${info.size}:${info.mtimeMs}:${info.ino}`);
    else if (info?.isFile()) hash.update(readFileSync(full));
    else if (info) throw new Error("Unsupported source entry requires private recovery support.");
    else hash.update(detached.get(file) ?? "missing");
  }
  parentPort.postMessage({ fingerprint: hash.digest("hex") });
} catch (error) {
  parentPort.postMessage({ error: error instanceof Error ? error.message : String(error) });
}
