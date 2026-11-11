import { useId, useState } from "react";
import { useT } from "../../../shared/i18n";
import { Modal, ModalActions } from "../../../shared/ui/Modal";
import { Button } from "../../../shared/ui/Button";
import { TextField } from "../../../shared/ui/TextField";
import { basename } from "../../../platform/tauri/fs";
import { folderRenameErrorWith } from "../model/projectFolderRename";

export function RenameProjectFolderDialog({
  path,
  onRename,
  onClose,
}: {
  path: string;
  onRename: (name: string) => Promise<void>;
  onClose: () => void;
}) {
  const t = useT();
  const [name, setName] = useState(basename(path));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const invalid = folderRenameErrorWith(name, t);
  const formId = useId();
  return (
    <Modal
      title={t("Rename folder")}
      description={t("Changes the folder name on disk and updates this project's saved paths.")}
      size="sm"
      onClose={() => {
        if (!busy) onClose();
      }}
      footer={
        <ModalActions>
          <Button type="button" disabled={busy} onClick={onClose} variant="ghost">
            {t("Cancel")}
          </Button>
          <Button
            type="submit"
            form={formId}
            disabled={busy || !!invalid || name === basename(path)}
            variant="primary"
            loading={busy}
            loadingLabel={t("Renaming…")}
          >
            {busy ? t("Renaming…") : t("Rename folder")}
          </Button>
        </ModalActions>
      }
    >
      <form
        id={formId}
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (busy || invalid || name === basename(path)) return;
          setBusy(true);
          setError(null);
          void onRename(name)
            .then(onClose)
            .catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)))
            .finally(() => setBusy(false));
        }}
      >
        <p className="break-all text-ui-caption text-(--ui-text-secondary)">{path}</p>
        <TextField
          label={t("Folder name")}
          autoFocus
          value={name}
          disabled={busy}
          error={invalid ?? error ?? undefined}
          onChange={(event) => {
            setName(event.target.value);
            setError(null);
          }}
        />
      </form>
    </Modal>
  );
}
