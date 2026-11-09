import type { ReactNode } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { Modal } from "../../../shared/ui/Modal";
import { CreateSkillForm } from "./SkillPicker";

/** New skill as a dialog over the library; the search text never becomes the name. */
export function CreateSkillDialog({
  cwd,
  error,
  busy,
  onCancel,
  onCreate,
}: {
  cwd: string;
  error: string | null;
  busy: boolean;
  onCancel: () => void;
  onCreate: (name: string, scope: "project" | "user") => void;
}): ReactNode {
  useLocale();
  return (
    <Modal title={t("New skill")} size="sm" onClose={() => !busy && onCancel()}>
      <CreateSkillForm
        query=""
        cwd={cwd}
        monospace={false}
        className=""
        showScopeHelp
        error={error}
        busy={busy}
        onCancel={onCancel}
        onCreate={onCreate}
      />
    </Modal>
  );
}
