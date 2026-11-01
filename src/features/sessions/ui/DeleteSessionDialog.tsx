import { useRef } from "react";
import { useT } from "../../../shared/i18n";
import { prettyCwd } from "../../../shared/lib/paths";
import { ConfirmDialog } from "../../../shared/ui/ConfirmDialog";

export type SessionDeleteChoice = {
  confirmed: boolean;
  deleteWorktree: boolean;
};

export function DeleteSessionDialog({
  title,
  unusedWorktree,
  onClose,
}: {
  title: string;
  unusedWorktree: string;
  onClose: (choice: SessionDeleteChoice) => void;
}) {
  const t = useT();
  const deleteWorktree = useRef(false);
  return (
    <ConfirmDialog
      request={{
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
      }}
      onResult={(result) => {
        deleteWorktree.current = result.acknowledged;
      }}
      onSettle={(confirmed) =>
        onClose({ confirmed, deleteWorktree: confirmed && deleteWorktree.current })
      }
    />
  );
}
