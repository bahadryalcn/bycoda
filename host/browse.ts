import { mkdir, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, parse, resolve } from "node:path";
import type { HostDirectory } from "../src/features/connections/model/protocol";
import type { FolderListing } from "../src/platform/tauri/fs";

/** Folder metadata only; file contents and mutations remain project-scoped. */
export async function browseHostFolder(
  rawPath: unknown,
  containing: unknown = false,
): Promise<Omit<FolderListing, "canOpenFiles">> {
  if (
    typeof rawPath !== "string" ||
    rawPath.length > 4096 ||
    rawPath.includes("\0") ||
    !isAbsolute(rawPath) ||
    typeof containing !== "boolean"
  )
    throw new Error("Invalid directory path");
  let path = resolve(rawPath);
  const info = await stat(path);
  if (!info.isDirectory()) {
    if (!containing || !info.isFile()) throw new Error("Path is not a directory");
    path = dirname(path);
  }
  const listed = (await readdir(path, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() || entry.isFile() || entry.isSymbolicLink())
    .sort(
      (a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name),
    )
    .slice(0, 500);
  const entries = await Promise.all(
    listed.map(async (entry) => ({
      name: entry.name,
      path: resolve(path, entry.name),
      isDir:
        entry.isDirectory() ||
        (entry.isSymbolicLink() &&
          !!(await stat(resolve(path, entry.name)).catch(() => null))?.isDirectory()),
      ignored: false,
    })),
  );
  return { path, parent: path === parse(path).root ? null : dirname(path), entries };
}

/** Lists host directories for the project picker without reading file contents. */
export async function browseHostDirectories(rawPath: unknown): Promise<HostDirectory> {
  if (
    rawPath !== undefined &&
    (typeof rawPath !== "string" || rawPath.length > 4096 || rawPath.includes("\0"))
  )
    throw new Error("Invalid directory path");
  const requested = typeof rawPath === "string" && rawPath.trim() ? rawPath : homedir();
  if (!isAbsolute(requested)) throw new Error("Choose an absolute directory path");
  const path = resolve(requested);
  if (!(await stat(path)).isDirectory()) throw new Error("Path is not a directory");
  const entries = (await readdir(path, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, 500)
    .map((entry) => ({ name: entry.name, path: resolve(path, entry.name) }));
  return {
    path,
    parent: path === parse(path).root ? null : dirname(path),
    entries,
    home: homedir(),
    roots:
      process.platform === "win32"
        ? (
            await Promise.all(
              Array.from({ length: 26 }, async (_, index) => {
                const root = `${String.fromCharCode(65 + index)}:\\`;
                return (await stat(root).catch(() => null))?.isDirectory()
                  ? { name: root, path: root }
                  : null;
              }),
            )
          ).filter((entry): entry is { name: string; path: string } => entry !== null)
        : [{ name: "/", path: "/" }],
  };
}

/** Creates exactly one child; never treats a name as a path or overwrites it. */
export async function createHostDirectory(rawPath: unknown, name: unknown): Promise<HostDirectory> {
  if (
    typeof name !== "string" ||
    !name.trim() ||
    name !== name.trim() ||
    name === "." ||
    name === ".." ||
    /[\\/\x00-\x1f<>:"|?*]/.test(name) ||
    /[. ]$/.test(name) ||
    /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(name)
  )
    throw new Error("Invalid folder name");
  if (typeof rawPath !== "string" || !rawPath.trim()) throw new Error("Invalid directory path");
  const parent = await browseHostDirectories(rawPath);
  const child = resolve(parent.path, name);
  await mkdir(child);
  return browseHostDirectories(child);
}
