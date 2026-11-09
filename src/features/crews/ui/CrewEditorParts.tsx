import { t } from "../../../shared/i18n";
import { Alert } from "../../../shared/ui/Alert";
import { Copy } from "../../../shared/ui/icons";
import { Button } from "../../../shared/ui/Button";
import { SegmentedControl } from "../../../shared/ui/SegmentedControl";
import { TextField } from "../../../shared/ui/TextField";
import type { CrewDefinition } from "../model/crew";
import type { useProjectCrews } from "../model/crewClient";
import { CrewDeleteButton } from "./CrewDeleteButton";

/** Crew name, plus where a new crew is available. */
export function CrewEditorHeader({
  draft,
  projectId,
  isNew,
  nameError,
  onChange,
}: {
  draft: CrewDefinition;
  projectId: string;
  isNew: boolean;
  nameError?: string;
  onChange: (patch: Partial<CrewDefinition>) => void;
}) {
  return (
    <div className="grid min-w-0 items-end gap-3 @min-[36rem]/crew-editor:grid-cols-[minmax(0,1fr)_auto]">
      <TextField
        label={t("Crew name")}
        placeholder={t("e.g. Mobile app")}
        value={draft.name}
        fieldClassName="min-w-0"
        autoFocus={isNew && !draft.name}
        error={nameError}
        onChange={(event) => onChange({ name: event.target.value })}
      />
      {isNew ? (
        <div className="flex min-w-0 flex-col items-start gap-1">
          <span className="text-ui-body font-medium">{t("Available in")}</span>
          <SegmentedControl
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
        </div>
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

/** Copy to the other scope and delete, for a stored crew. */
export function CrewMaintenance({
  state,
  crew,
  copyLabel,
  pending,
  onCopy,
  onPendingChange,
  onDeleted,
}: {
  state: ReturnType<typeof useProjectCrews>;
  crew: CrewDefinition;
  copyLabel: string;
  pending: boolean;
  onCopy: () => void;
  onPendingChange: (busy: boolean) => void;
  onDeleted: () => void;
}) {
  return (
    <div className="flex flex-wrap items-start gap-2">
      <Button
        variant="secondary"
        startIcon={<Copy aria-hidden className="icon-sm" />}
        disabled={pending}
        onClick={onCopy}
      >
        {copyLabel}
      </Button>
      <div className="flex flex-col gap-2 empty:hidden">
        <CrewDeleteButton
          state={state}
          crew={crew}
          disabled={pending}
          onPendingChange={onPendingChange}
          onDeleted={onDeleted}
        />
      </div>
    </div>
  );
}
