import { createHash } from "node:crypto";
import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import { basename, dirname, join, relative, sep } from "node:path";
import { existingPath, workspacePath } from "./workspace";
import type { WorkspaceCommands } from "./workspace-commands";

const queues = new Map<string, Promise<void>>();
const MAX_ENTRIES = 2000;
const MAX_BYTES = 32 * 1024 * 1024;

/** A bounded inventory proves exactly which file/tree an agent has inspected. */
export async function inspectConversationPath(root: string, input: unknown) {
  const source = await existingPath(root, input);
  const entries: { path: string; kind: string; hash?: string; size: number }[] = [];
  let bytes = 0;
  const visit = async (path: string): Promise<void> => {
    workspacePath(root, path);
    const info = await lstat(path);
    if (info.isSymbolicLink() || (!info.isFile() && !info.isDirectory()))
      throw new Error("Links and special files cannot be mutated through Conversation Tools.");
    if (entries.length >= MAX_ENTRIES) throw new Error("File tree exceeds the inspection limit.");
    const entry = {
      path: relative(source, path).replaceAll("\\", "/"),
      kind: info.isDirectory() ? "directory" : "file",
      size: info.isDirectory() ? 0 : info.size,
      hash: undefined as string | undefined,
    };
    entries.push(entry);
    if (info.isDirectory()) {
      for (const name of (await readdir(path)).sort()) await visit(join(path, name));
    } else {
      bytes += info.size;
      if (bytes > MAX_BYTES) throw new Error("File tree exceeds the inspection byte limit.");
      entry.hash = createHash("sha256")
        .update(await readFile(path))
        .digest("hex");
    }
  };
  // Reject a link at the supplied path too, before canonical resolution can hide it.
  if ((await lstat(workspacePath(root, input))).isSymbolicLink())
    throw new Error("Links cannot be mutated.");
  await visit(source);
  return {
    path: relative(root, source).replaceAll("\\", "/"),
    kind: entries[0].kind,
    hash:
      entries[0].kind === "file"
        ? entries[0].hash!
        : createHash("sha256").update(JSON.stringify(entries)).digest("hex"),
    entries: entries.length,
    bytes,
  };
}

/** Use the editor's existing filesystem operations, scoped to one verified checkout. */
export async function mutateConversationPath(
  root: string,
  action: string,
  input: Record<string, unknown>,
  execute: WorkspaceCommands["run"],
) {
  const canonical = await realpath(root);
  const key = process.platform === "win32" ? canonical.toLowerCase() : canonical;
  const previous = queues.get(key) ?? Promise.resolve();
  const result = previous.then(async () => {
    const before = await inspectConversationPath(root, input.path);
    if (before.hash !== input.expectedHash)
      throw new Error("Path changed; inspect it again before changing it.");
    const path = workspacePath(root, before.path);
    if (action === "files.delete") {
      await execute("delete_path", { path, expectedHash: input.expectedHash });
      return { path: before.path, deleted: true };
    }
    let target: string;
    if (action === "files.rename") {
      if (
        typeof input.name !== "string" ||
        !input.name.trim() ||
        /[\\/\0]/.test(input.name) ||
        [".", ".."].includes(input.name)
      )
        throw new Error("Provide one file or folder name.");
      target = workspacePath(root, join(dirname(path), input.name));
    } else {
      const parent = await existingPath(root, input.destinationParent, true);
      if (!(await lstat(parent)).isDirectory())
        throw new Error("Destination parent must be a directory.");
      target = workspacePath(root, join(parent, basename(path)));
    }
    const rel = relative(path, target);
    if (!rel || (rel !== ".." && !rel.startsWith(`..${sep}`) && before.kind === "directory"))
      throw new Error("Choose a destination outside the source tree.");
    // The service also checks collisions. Do not silently rename a copy or overwrite a target.
    if (
      await lstat(target).then(
        () => true,
        (error: NodeJS.ErrnoException) => {
          if (error.code !== "ENOENT") throw error;
          return false;
        },
      )
    )
      throw new Error("Destination already exists.");
    const output = await execute(
      action === "files.rename"
        ? "rename_path"
        : action === "files.move"
          ? "move_path"
          : "copy_path",
      action === "files.rename"
        ? { path, name: input.name, expectedHash: input.expectedHash }
        : { from: path, destParent: dirname(target), expectedHash: input.expectedHash },
    );
    return {
      path: relative(root, String(output)).replaceAll("\\", "/"),
      source: before.path,
      changed: true,
    };
  });
  const settled = result.then(
    () => {},
    () => {},
  );
  queues.set(key, settled);
  void settled.then(() => {
    if (queues.get(key) === settled) queues.delete(key);
  });
  return result;
}
