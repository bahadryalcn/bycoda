import { useState } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { Modal } from "../../../shared/ui/Modal";
import { Button } from "../../../shared/ui/Button";
import { TextField } from "../../../shared/ui/TextField";
import { Alert } from "../../../shared/ui/Alert";
import { basename } from "../../../platform/tauri/fs";
import { folderRenameError } from "../model/projectFolderRename";

export function RenameProjectFolderDialog({
  path,
  onRename,
  onClose,
}: {
  path: string;
  onRename: (name: string) => Promise<void>;
  onClose: () => void;
}) {
  useLocale();
  const [name, setName] = useState(basename(path));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const invalid = folderRenameError(name);
  return (
    <Modal
      title={t("Rename folder")}
      description={t("Changes the folder name on disk and updates this project's saved paths.")}
      size="sm"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form
        className="space-y-3 p-4"
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
        <p className="break-all text-xs text-(--ui-text-secondary)">{path}</p>
        <label className="block space-y-1 text-xs text-(--ui-text-secondary)">
          <span>{t("Folder name")}</span>
          <TextField
            label=""
            hideLabel
            autoFocus
            value={name}
            disabled={busy}
            onChange={(event) => {
              setName(event.target.value);
              setError(null);
            }}
            aria-invalid={!!invalid || !!error}
          />
        </label>
        {invalid || error ? <Alert tone="danger">{invalid ?? error}</Alert> : null}
        <div className="flex justify-end gap-2">
          <Button type="button" disabled={busy} onClick={onClose} variant="secondary">
            {t("Cancel")}
          </Button>
          <Button
            type="submit"
            disabled={busy || !!invalid || name === basename(path)}
            variant="primary"
            loading={busy}
            loadingLabel={t("Renaming…")}
          >
            {busy ? t("Renaming…") : t("Rename folder")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
