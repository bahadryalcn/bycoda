import { dirname } from "node:path";
import { workspacePathKey } from "../workspaces/workspace-paths";

/** Index every ancestor so a workspace probe touches only terminals inside it. */
export class TerminalWorkspaceIndex {
  private readonly byRoot = new Map<string, Set<string>>();
  add(id: string, cwd: string): void {
    for (let path = workspacePathKey(cwd); ;) {
      const ids = this.byRoot.get(path) ?? new Set<string>();
      ids.add(id);
      this.byRoot.set(path, ids);
      const parent = dirname(path);
      if (parent === path) break;
      path = parent;
    }
  }
  delete(id: string, cwd: string): void {
    for (let path = workspacePathKey(cwd); ;) {
      const ids = this.byRoot.get(path);
      ids?.delete(id);
      if (ids?.size === 0) this.byRoot.delete(path);
      const parent = dirname(path);
      if (parent === path) break;
      path = parent;
    }
  }
  ids(root: string): readonly string[] {
    return [...(this.byRoot.get(workspacePathKey(root)) ?? [])];
  }
}
