import { slash } from "../../../shared/lib/paths";

type WorkspaceInvoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;
export type MovePathResult =
  | string
  | { path: string; recoveryPath: string; receiptPath: string; warning?: string | null };

/** Route filesystem mutations through the owning workspace machine. */
export function createWorkspacePathMutations(invoke: WorkspaceInvoke) {
  return {
    renamePath: (path: string, name: string): Promise<string> =>
      invoke<string>("rename_path", { path, name }).then(slash),
    deletePath: (path: string): Promise<void> => invoke<void>("delete_path", { path }),
    copyPath: (from: string, destParent: string): Promise<string> =>
      invoke<string>("copy_path", { from, destParent }).then(slash),
    movePath: (from: string, destParent: string): Promise<MovePathResult> =>
      invoke<MovePathResult>("move_path", { from, destParent }).then((result) =>
        typeof result === "string" ? slash(result) : { ...result, path: slash(result.path) },
      ),
  };
}
