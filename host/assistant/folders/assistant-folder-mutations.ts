import { cp, rm } from "node:fs/promises";
import { basename, dirname, relative, resolve } from "node:path";
import { moveWithRecovery } from "../../workspaces/cross-volume-move";
import { renameWithRetry } from "../../storage/rename-retry";
import { inspectConversationPath } from "../../conversation/conversation-file-mutations";
import { existingPath, invalidateHostFilePaths, workspacePath } from "../../workspaces/workspace";

/** The editor's rename/copy/move/delete effects for one owner-chosen folder. The Workspace
 * service only admits registered project roots, so this performs the same four commands on a
 * folder root. `mutateConversationPath` has already inspected, hashed and collision-checked the
 * tree; this re-verifies the fingerprint directly before the effect. */
export function folderWorkspaceRun(root: string, authorized: () => Promise<boolean>) {
  const check = async () => {
    if (!(await authorized())) throw new Error("Assistant folder authority revoked.");
  };
  const verify = async (input: unknown, path: string, expectedHash: unknown) => {
    const inspected = await inspectConversationPath(root, input);
    if (inspected.hash !== expectedHash || (await existingPath(root, input)) !== path)
      throw new Error("Path changed before commit; inspect it again.");
  };
  const within = (path: string) => {
    const rel = relative(root, path);
    if (!rel) throw new Error("The folder root itself cannot be changed.");
    return workspacePath(root, rel);
  };
  return async (command: unknown, value: unknown): Promise<unknown> => {
    const input = value as Record<string, unknown>;
    await check();
    if (command === "delete_path") {
      const path = await existingPath(root, input.path);
      await verify(input.path, path, input.expectedHash);
      await check();
      await rm(path, { recursive: true });
      invalidateHostFilePaths(root);
      return undefined;
    }
    if (command === "rename_path") {
      const from = await existingPath(root, input.path);
      const to = within(resolve(dirname(from), String(input.name)));
      await verify(input.path, from, input.expectedHash);
      await check();
      await renameWithRetry(from, to);
      invalidateHostFilePaths(root);
      return to;
    }
    if (command === "copy_path" || command === "move_path") {
      const from = await existingPath(root, input.from);
      const parent = await existingPath(root, input.destParent, true);
      const to = within(resolve(parent, basename(from)));
      await verify(input.from, from, input.expectedHash);
      await check();
      if (command === "copy_path")
        await cp(from, to, { recursive: true, errorOnExist: true, force: false });
      else await moveWithRecovery(from, to, authorized);
      invalidateHostFilePaths(root);
      return to;
    }
    throw new Error("Unsupported Assistant folder command.");
  };
}
