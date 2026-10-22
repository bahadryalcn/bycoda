import { Checkbox } from "../../../shared/ui/Checkbox";
import { Button } from "../../../shared/ui/Button";
import { t, useLocale } from "../../../shared/i18n";
import { useState } from "react";
import { prettyCwd } from "../../../shared/lib/paths";
import { Modal } from "../../../shared/ui/Modal";

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
  useLocale();
  const [deleteWorktree, setDeleteWorktree] = useState(false);
  return (
    <Modal
      title={t("Delete session?")}
      size="sm"
      onClose={() => onClose({ confirmed: false, deleteWorktree: false })}
    >
      <div className="flex flex-col gap-4 p-4 text-[12px]">
        <p>
          “{title}
          {t("” will be permanently deleted.")}
        </p>
        <label className="flex items-start gap-2">
          <Checkbox
            checked={deleteWorktree}
            onChange={(e) => setDeleteWorktree(e.target.checked)}
            className="mt-0.5"
          />
          <span>
            {t("Also delete the unused worktree")}
            <span className="mt-1 block break-all text-[11px] text-(--ui-text-secondary)">
              {prettyCwd(unusedWorktree)}
            </span>
            <span className="mt-1 block text-[11px] text-(--ui-text-secondary)">
              {t("The branch is kept. If files have uncommitted changes, the worktree stays.")}
            </span>
          </span>
        </label>
        <div className="flex justify-end gap-2">
          <Button
            variant="ghost"
            type="button"
            onClick={() => onClose({ confirmed: false, deleteWorktree: false })}
          >
            {t("Cancel")}
          </Button>
          <Button
            variant="ghost"
            type="button"
            onClick={() => onClose({ confirmed: true, deleteWorktree })}
          >
            {t("Delete session")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
