import { useState } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { Modal } from "../../../shared/ui/Modal";
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
        <p className="break-all text-xs text-content/60">{path}</p>
        <label className="block space-y-1 text-xs text-content/80">
          <span>{t("Folder name")}</span>
          <input
            autoFocus
            value={name}
            disabled={busy}
            onChange={(event) => {
              setName(event.target.value);
              setError(null);
            }}
            aria-invalid={!!invalid || !!error}
            className="w-full rounded-md border border-content/15 bg-content/5 px-2 py-2 text-sm focus-visible:outline focus-visible:outline-accent"
          />
        </label>
        {invalid || error ? (
          <p role="alert" className="text-xs text-red-400">
            {invalid ?? error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="rounded-md px-3 py-2 text-xs hover:bg-content/10 active:bg-content/15"
          >
            {t("Cancel")}
          </button>
          <button
            type="submit"
            disabled={busy || !!invalid || name === basename(path)}
            className="rounded-md bg-accent/15 px-3 py-2 text-xs hover:bg-accent/25 active:bg-accent/30 disabled:opacity-40"
          >
            {busy ? t("Renaming…") : t("Rename folder")}
          </button>
        </div>
      </form>
    </Modal>
  );
}
