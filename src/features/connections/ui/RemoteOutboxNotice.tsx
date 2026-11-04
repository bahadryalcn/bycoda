import { Alert } from "../../../shared/ui/Alert";
import { Button } from "../../../shared/ui/Button";
import { Checkbox } from "../../../shared/ui/Checkbox";
import { t, useLocale } from "../../../shared/i18n";
import { useState } from "react";
import {
  archiveDurableRemoteOutboxIssue,
  useDurableRemoteOutboxIssues,
} from "../model/remoteOutbox";

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
  if (!issues.length) return null;
  const issue = issues[0];
  if (issue.unavailable)
    return (
      <Alert tone="warning">
        {issue.loading
          ? t("Checking saved requests…")
          : t("Saved requests cannot be read. Sending is held until storage is available.")}
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
