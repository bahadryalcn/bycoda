import { stat } from "node:fs/promises";
import { withWorkspaceMutation } from "./workspace-mutations";

// Connections may own different command instances. Windows cannot replace the
// same destination concurrently, so serialize canonical destinations host-wide.
const textFileSaves = new Map<string, Promise<unknown>>();

/** The stamp the transfer commands use: it changes with any write, replace or touch. */
export function fileVersion(info: {
  dev: bigint;
  ino: bigint;
  size: bigint;
  mtimeNs: bigint;
  ctimeNs: bigint;
}): string {
  return [info.dev, info.ino, info.size, info.mtimeNs, info.ctimeNs].join(":");
}

/** Refusal to save over a file that changed after it was read; clients match `FILE_CHANGED`. */
export function fileChangedError(): Error {
  return Object.assign(
    new Error("FILE_CHANGED: The file changed on disk after it was opened. Nothing was saved."),
    { code: "FILE_CHANGED" },
  );
}

/** The target's stats, or `undefined` when it does not exist. */
export async function statSaveTarget(path: string) {
  return await stat(path, { bigint: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
    return undefined;
  });
}

/** Runs one save of `path` after every earlier save of it, inside the workspace mutation fence. */
export async function serializeTextSave<T>(
  root: string,
  path: string,
  save: () => Promise<T>,
): Promise<T> {
  const key = process.platform === "win32" ? path.toLowerCase() : path;
  const pending = (textFileSaves.get(key) ?? Promise.resolve()).then(
    async () => await withWorkspaceMutation(root, save),
    async () => await withWorkspaceMutation(root, save),
  );
  textFileSaves.set(key, pending);
  try {
    return await pending;
  } finally {
    if (textFileSaves.get(key) === pending) textFileSaves.delete(key);
  }
}
