import type { ReactNode } from "react";
import { t } from "../../../shared/i18n";
import { Alert } from "../../../shared/ui/Alert";
import { Button } from "../../../shared/ui/Button";
import { RadioGroup } from "../../../shared/ui/RadioGroup";
import { TextField } from "../../../shared/ui/TextField";
import type { CrewDefinition } from "../model/crew";

/**
 * The editor's top row: the crew look button, the name and the access chip; a new crew also
 * chooses where it is available.
 */
export function CrewEditorHeader({
  draft,
  projectId,
  isNew,
  nameError,
  onChange,
  look,
  access,
}: {
  draft: CrewDefinition;
  projectId: string;
  isNew: boolean;
  nameError?: string;
  onChange: (patch: Partial<CrewDefinition>) => void;
  /** The look button (`CrewAppearancePicker`). */
  look: ReactNode;
  /** The access chip (`CrewAccessRow`). */
  access: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex min-w-0 items-start gap-2">
        <div className="shrink-0">{look}</div>
        <TextField
          label={t("Crew name")}
          hideLabel
          placeholder={t("Crew name")}
          value={draft.name}
          fieldClassName="min-w-0 flex-1"
          autoFocus={isNew && !draft.name}
          error={nameError}
          onChange={(event) => onChange({ name: event.target.value })}
        />
        <div className="shrink-0 empty:hidden">{access}</div>
      </div>
      {isNew ? (
        <RadioGroup
          variant="inline"
          label={t("Available in")}
          value={draft.projectId ? "project" : "global"}
          options={[
            { value: "project", label: t("This project") },
            { value: "global", label: t("All projects") },
          ]}
          onValueChange={(scope) =>
            onChange({ projectId: scope === "project" ? projectId : undefined })
          }
        />
      ) : null}
    </div>
  );
}

/** Action errors, a failed model catalog and the revision-conflict choices. */
export function CrewEditorBanners({
  error,
  catalogError,
  pending,
  onRetryCatalog,
  conflict,
  onKeepAsNew,
  onLoadLatest,
}: {
  error: string;
  catalogError?: string;
  pending: boolean;
  onRetryCatalog: () => void;
  conflict?: "missing" | "changed";
  onKeepAsNew: () => void;
  /** Absent when the stored crew is gone. */
  onLoadLatest?: () => void;
}) {
  return (
    <>
      {error ? (
        // A failed action must be seen even when the roster is scrolled far down.
        <div ref={(element) => element?.scrollIntoView({ block: "nearest" })}>
          <Alert tone="danger">{error}</Alert>
        </div>
      ) : null}
      {catalogError ? (
        <Alert tone="warning">
          {catalogError}
          <Button variant="ghost" disabled={pending} onClick={onRetryCatalog}>
            {t("Retry")}
          </Button>
        </Alert>
      ) : null}
      {conflict ? (
        <Alert tone="warning">
          <p>
            {conflict === "missing"
              ? t("This crew is no longer available.")
              : t(
                  "This crew changed in another session. Keep your edits as a new crew or discard them to load the latest version.",
                )}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button onClick={onKeepAsNew}>{t("Keep edits as new crew")}</Button>
            <Button disabled={!onLoadLatest} onClick={onLoadLatest}>
              {t("Discard edits and load latest")}
            </Button>
          </div>
        </Alert>
      ) : null}
    </>
  );
}
