import { TextField } from "../../../shared/ui/TextField";
import { Button } from "../../../shared/ui/Button";
import { t, useLocale } from "../../../shared/i18n";
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
  useLocale();
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
      <form onSubmit={submit} className="flex flex-col gap-4 p-4 text-[12px]">
        <label className="flex flex-col gap-1.5">
          <span className="font-medium text-(--ui-text-secondary)">
            {t("Issue or pull request URL")}
          </span>
          <TextField
            hideLabel
            label=""
            autoFocus
            type="url"
            value={url}
            aria-label={t("GitHub issue or pull request URL")}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "linked-work-item-error" : undefined}
            placeholder="https://github.com/owner/repo/pull/123"
            onChange={(event) => {
              setUrl(event.target.value);
              if (error) setError("");
            }}
          />
          {error ? (
            <span
              id="linked-work-item-error"
              role="alert"
              className="text-[11px] text-(--ui-tone-danger-fg)"
            >
              {error}
            </span>
          ) : (
            <span className="text-[11px] text-(--ui-text-secondary)">
              {t("Paste the full github.com URL. The linked item will appear on the session card.")}
            </span>
          )}
        </label>
        <div className="flex items-center justify-end gap-2">
          {initial ? (
            <Button
              variant="ghost"
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
          <Button variant="ghost" type="submit">
            {initial ? t("Update link") : t("Link")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
