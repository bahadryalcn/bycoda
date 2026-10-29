import { TextField } from "../../../shared/ui/TextField";
import { Button } from "../../../shared/ui/Button";
import { useT } from "../../../shared/i18n";
import { useState, type FormEvent } from "react";
import { Modal } from "../../../shared/ui/Modal";
import type { LinkedWorkItem } from "../model/session";
import { parseGithubWorkItemUrl } from "../model/sessionWorkItem";

export function LinkSessionWorkItemDialog({
  initial,
  sessionTitle,
  onSave,
  onClose,
}: {
  initial?: LinkedWorkItem;
  sessionTitle: string;
  onSave: (item: LinkedWorkItem | undefined) => void;
  onClose: () => void;
}) {
  const t = useT();
  const [url, setUrl] = useState(initial?.url ?? "");
  const [error, setError] = useState("");

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const item = parseGithubWorkItemUrl(url.trim());
    if (!item) {
      setError("Enter a valid GitHub issue or pull request URL.");
      return;
    }
    onSave(item);
  };

  return (
    <Modal
      title={initial ? t("Edit GitHub link") : t("Link GitHub issue or PR")}
      description={sessionTitle}
      size="sm"
      onClose={onClose}
    >
      <form onSubmit={submit} className="flex flex-col gap-4 p-4 text-ui-caption">
        <TextField
          label={t("Issue or pull request URL")}
          autoFocus
          type="url"
          value={url}
          aria-label={t("GitHub issue or pull request URL")}
          description={
            error
              ? undefined
              : t("Paste the full github.com URL. The linked item will appear on the session card.")
          }
          error={error || undefined}
          placeholder="https://github.com/owner/repo/pull/123"
          onChange={(event) => {
            setUrl(event.target.value);
            if (error) setError("");
          }}
        />
        <div className="flex items-center justify-end gap-2">
          {initial ? (
            <Button
              variant="ghost"
              tone="danger"
              type="button"
              onClick={() => onSave(undefined)}
              className="mr-auto"
            >
              {t("Remove link")}
            </Button>
          ) : null}
          <Button variant="ghost" type="button" onClick={onClose}>
            {t("Cancel")}
          </Button>
          <Button variant="primary" type="submit">
            {initial ? t("Update link") : t("Link")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
