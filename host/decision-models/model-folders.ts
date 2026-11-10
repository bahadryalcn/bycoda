import { opendir, realpath } from "node:fs/promises";
import { basename, extname, isAbsolute, join, relative } from "node:path";
import { readGgufHeader } from "./gguf";

const MAX_DEPTH = 8;
const MAX_ENTRIES = 20_000;
export const MAX_FOLDER_MODELS = 200;

/** Projectors accompany a vision model; they are never standalone decision models. */
export function isProjector(path: string): boolean {
  return /(?:^|[-_.])(?:mmproj|projector)(?:[-_.]|$)/i.test(basename(path));
}

/** Resolves a manifest path without letting symlinks or relative traversal leave its folder. */
export async function insideFile(root: string, path: string): Promise<string | undefined> {
  const real = await realpath(path).catch(() => undefined);
  if (!real) return undefined;
  const within = relative(root, real);
  return within && !within.startsWith("..") && !isAbsolute(within) ? real : undefined;
}

/** Bounded breadth-first walk. Models are emitted immediately, before later folders use the budget. */
export async function scanModelFolder(
  folder: string,
  signal: AbortSignal,
  onModel: (path: string) => void,
): Promise<{ incomplete: boolean }> {
  const root = await realpath(folder).catch(() => undefined);
  if (!root) return { incomplete: true };
  const queue = [{ folder: root, depth: 0 }];
  let visited = 0;
  let models = 0;
  let incomplete = false;
  for (let index = 0; index < queue.length; index++) {
    if (signal.aborted) return { incomplete: true };
    const current = queue[index];
    const directory = await opendir(current.folder).catch(() => undefined);
    if (!directory) {
      incomplete = true;
      continue;
    }
    try {
      for await (const entry of directory) {
        if (signal.aborted || ++visited > MAX_ENTRIES || models >= MAX_FOLDER_MODELS)
          return { incomplete: true };
        if (entry.isSymbolicLink()) continue;
        const path = join(current.folder, entry.name);
        if (entry.isDirectory()) {
          if (current.depth < MAX_DEPTH) queue.push({ folder: path, depth: current.depth + 1 });
          else incomplete = true;
        } else if (
          entry.isFile() &&
          extname(path).toLowerCase() === ".gguf" &&
          !isProjector(path)
        ) {
          const real = await insideFile(root, path);
          if (real && (await readGgufHeader(real))) {
            models++;
            onModel(real);
          }
        }
      }
    } catch {
      incomplete = true;
    }
  }
  return { incomplete };
}
