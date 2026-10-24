import { realpath } from "node:fs/promises";

const pending = new Map<string, Promise<void>>();

/** Editor saves and path lifecycle operations share one checkout commit order. */
export async function withWorkspaceMutation<T>(
  root: string,
  operation: () => Promise<T>,
): Promise<T> {
  const canonical = await realpath(root);
  const key = process.platform === "win32" ? canonical.toLowerCase() : canonical;
  const result = (pending.get(key) ?? Promise.resolve()).then(operation);
  const settled = result.then(
    () => {},
    () => {},
  );
  pending.set(key, settled);
  try {
    return await result;
  } finally {
    if (pending.get(key) === settled) pending.delete(key);
  }
}
