import { Text } from "../../../shared/ui/Text";
import { useId, useState } from "react";
import { useT } from "../../../shared/i18n";
import { Modal, ModalActions } from "../../../shared/ui/Modal";
import { Button } from "../../../shared/ui/Button";
import { TextField } from "../../../shared/ui/TextField";
import { basename } from "../../../platform/tauri/fs";
import { folderRenameErrorWith } from "../model/projectFolderRename";
import { RemoteActionError } from "../../connections/public/RemoteActionError";
import { describeRemoteError, type RemoteErrorView } from "../../connections/public/remoteFailure";

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
  const [error, setError] = useState<RemoteErrorView | null>(null);
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
        // The invalid-name sentence shows once, on the field; an unchanged name needs no message.
        <ModalActions>
          <Button type="button" disabled={busy} onClick={onClose} variant="ghost">
            {t("Cancel")}
          </Button>
          <Button
            type="submit"
            form={formId}
            disabled={busy || !!invalid || name === basename(path)}
            disabledReason={
              busy
                ? t("Wait for the current operation to finish")
                : invalid
                  ? t("Enter a valid folder name.")
                  : t("Change the name first.")
            }
            variant="primary"
            loading={busy}
            loadingLabel={t("Renaming…")}
          >
            {t("Rename folder")}
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
            .catch((reason: unknown) => setError(describeRemoteError(reason)))
            .finally(() => setBusy(false));
        }}
      >
        <Text as="p" size="caption" tone="secondary" className="break-all">
          {path}
        </Text>
        <TextField
          label={t("Folder name")}
          autoFocus
          value={name}
          disabled={busy}
          error={invalid ?? undefined}
          onChange={(event) => {
            setName(event.target.value);
            setError(null);
          }}
        />
        {/* The typed name stays in the field; the failure sits below it with its raw text behind Details. */}
        {error ? <RemoteActionError error={error} /> : null}
      </form>
    </Modal>
  );
}
