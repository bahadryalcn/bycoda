import { errorText } from "../../../shared/lib/errors";
import { gitDeleteBranch } from "../../../platform/tauri/fs";
import { t } from "../../../shared/i18n/git";
import { confirmGitAction } from "./gitConfirmation";

/**
 * Delete a local branch after confirming. When git refuses because the branch
 * is unmerged, offers to force it. Resolves quietly if the user declines;
 * throws git's message on any other failure.
 */
export async function deleteLocalBranch(cwd: string, name: string): Promise<void> {
  const confirmed = await confirmGitAction({
    title: t("Delete branch?"),
    message: t(
      "The local branch “{p0}” will be deleted. Git asks again if it has unmerged commits.",
      { p0: name },
    ),
    confirmLabel: t("Delete branch"),
  });
  if (!confirmed) return;
  try {
    await gitDeleteBranch(cwd, name);
  } catch (error) {
    if (!errorText(error).includes("not fully merged")) throw error;
    const force = await confirmGitAction({
      title: t("Delete unmerged branch?"),
      message: t(
        "“{p0}” has commits that are not merged anywhere else. Deleting it anyway loses those commits.",
        { p0: name },
      ),
      confirmLabel: t("Delete anyway"),
    });
    if (force) await gitDeleteBranch(cwd, name, true);
  }
}
