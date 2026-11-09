import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { durableWrite } from "./turn-git-history";

/** Execution-host policy shared by native and Host turns. Missing means OFF. */
export function createExactGitRewindPolicy(root: string) {
  const path = join(root, "exact-git-rewind.json");
  const read = async (): Promise<boolean> => {
    try {
      const value = JSON.parse(await readFile(path, "utf8"));
      if (typeof value?.enabled !== "boolean") throw new Error("Invalid exact Git rewind policy");
      return value.enabled;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    }
  };
  return {
    read,
    // Policy failures disable the experiment; normal worktree sends stay available.
    enabled: async () => read().catch(() => false),
    async save(enabled: boolean): Promise<void> {
      if (typeof enabled !== "boolean") throw new Error("Exact Git rewind must be a boolean");
      await durableWrite(path, JSON.stringify({ enabled }));
    },
  };
}
