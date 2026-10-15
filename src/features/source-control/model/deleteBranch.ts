import { errorText } from "../../../shared/lib/errors";
import { ask } from "@tauri-apps/plugin-dialog";
import { gitDeleteBranch } from "../../../platform/tauri/fs";
import { appName } from "../../../shared/lib/appName";

/**
 * Delete a local branch after confirming. When git refuses because the branch
 * is unmerged, offers to force it. Resolves quietly if the user declines;
 * throws git's message on any other failure.
 */
export async function deleteLocalBranch(cwd: string, name: string): Promise<void> {
  const confirmed = await ask(`Delete branch ${name}?`, {
    title: appName(),
    kind: "warning",
    okLabel: "Delete",
  });
  if (!confirmed) return;
  try {
    await gitDeleteBranch(cwd, name);
  } catch (error) {
    if (!errorText(error).includes("not fully merged")) throw error;
    const force = await ask(
      `${name} has commits that are not merged anywhere else. Delete it anyway? Those commits are lost.`,
      { title: appName(), kind: "warning", okLabel: "Delete Anyway" },
    );
    if (force) await gitDeleteBranch(cwd, name, true);
  }
}
