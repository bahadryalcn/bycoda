import { useT } from "../../../shared/i18n";
import { prettyCwd } from "../../../shared/lib/paths";
import type { ConfirmRequest } from "../../../shared/ui/ConfirmDialog";

/** Builds the in-app prompt for deleting one conversation from its session list. */
export function useSessionDeleteDialogRequest(
  title: string,
  unusedWorktree: string,
): ConfirmRequest {
  const t = useT();
  return {
    title: t("Delete session?"),
    message: (
      <>
        “{title}
        {t("” will be permanently deleted.")}
      </>
    ),
    confirmLabel: t("Delete session"),
    acknowledge: {
      label: t("Also delete the unused worktree"),
      description: (
        <>
          <span className="block break-all">{prettyCwd(unusedWorktree)}</span>
          <span className="mt-1 block">
            {t("The branch is kept. If files have uncommitted changes, the worktree stays.")}
          </span>
        </>
      ),
    },
  };
}
