import { Alert } from "../../../shared/ui/Alert";
import { Button } from "../../../shared/ui/Button";
import { Checkbox } from "../../../shared/ui/Checkbox";
import { t, useLocale } from "../../../shared/i18n";
import { useState } from "react";
import {
  archiveDurableRemoteOutboxIssue,
  useDurableRemoteOutboxIssues,
} from "../model/remoteOutbox";
import { exportOversizedOutboxRecord } from "../model/remoteOutboxDatabase";

export function RemoteOutboxNotice({
  project,
  environment,
}: {
  project?: string;
  environment?: string;
}) {
  useLocale();
  const issues = useDurableRemoteOutboxIssues(project, environment);
  const [reviewed, setReviewed] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [exportedFor, setExportedFor] = useState<string | null>(null);
  if (!issues.length) return null;
  const issue = issues[0];
  if (issue.unavailable)
    return (
      <Alert tone="warning">
        <p>
          {issue.loading
            ? t("Checking saved requests…")
            : issue.oversized
              ? t(
                  "A saved request is too large to read safely. Its original bytes are preserved and sending is held.",
                )
              : t("Saved requests cannot be read. Sending is held until storage is available.")}
        </p>
        {issue.oversizedRecord && (
          <>
            <p>
              {t("Export the stored request record for review. It may contain conversation data.")}
            </p>
            <Button
              type="button"
              loading={saving}
              onClick={() => {
                const record = issue.oversizedRecord!;
                setSaving(true);
                setError(null);
                void exportOversizedOutboxRecord(record)
                  .then((result) => {
                    if (!result.cancelled) setExportedFor(`${record.key}:${record.version}`);
                  })
                  .catch((cause: unknown) =>
                    setError(cause instanceof Error ? cause.message : String(cause)),
                  )
                  .finally(() => setSaving(false));
              }}
            >
              {t("Export saved request")}
            </Button>
            {exportedFor === `${issue.oversizedRecord.key}:${issue.oversizedRecord.version}` && (
              <p>{t("Saved request exported.")}</p>
            )}
            {error && <p>{error}</p>}
          </>
        )}
      </Alert>
    );
  return (
    <Alert role="alert" tone="warning">
      <p className="font-medium">{t("An unfinished request needs recovery")}</p>
      <p className="leading-relaxed text-content">
        {issues.length === 1
          ? t(
              "1 saved request could not be safely reconciled. Check the conversations on the host before sending again; a request may already have run.",
            )
          : t(
              "{p0} saved requests could not be safely reconciled. Check the conversations on the host before sending again; a request may already have run.",
              { p0: issues.length },
            )}
      </p>
      <p className="break-all text-content">{t("Project: {p0}", { p0: issue.project })}</p>
      <label className="flex items-start gap-2">
        <Checkbox
          checked={reviewed === issue.key}
          onChange={(event) => setReviewed(event.target.checked ? issue.key : null)}
        />
        {t("I checked the host and understand that this request will not be retried.")}
      </label>
      <Button
        type="button"
        disabled={reviewed !== issue.key || saving}

        onClick={() => {
          setSaving(true);
          void archiveDurableRemoteOutboxIssue(issue.key)
            .then(() => {
              setReviewed(null);
              setError(null);
            })
            .catch((reason: unknown) =>
              setError(reason instanceof Error ? reason.message : "Could not archive the request."),
            )
            .finally(() => setSaving(false));
        }}
        variant="secondary"
      >
        {t("Archive reviewed request")}
      </Button>
      {error ? (
        <Alert role="alert" tone="warning">
          {error}
        </Alert>
      ) : null}
    </Alert>
  );
}
