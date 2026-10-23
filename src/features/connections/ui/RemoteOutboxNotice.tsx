import { Alert } from "../../../shared/ui/Alert";
import { Button } from "../../../shared/ui/Button";
import { Checkbox } from "../../../shared/ui/Checkbox";
import { t, useLocale } from "../../../shared/i18n";
import { useState } from "react";
import { archiveRemoteOutboxIssue, useRemoteOutboxIssues } from "../model/remoteOutbox";

export function RemoteOutboxNotice({
  project,
  environment,
}: {
  project?: string;
  environment?: string;
}) {
  useLocale();
  const issues = useRemoteOutboxIssues(project, environment);
  const [reviewed, setReviewed] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!issues.length) return null;
  const issue = issues[0];
  return (
    <Alert role="alert" tone="warning">
      <p className="font-medium">{t("An unfinished request needs recovery")}</p>
      <p className="leading-relaxed text-content">
        {issues.length === 1
          ? t(
              "1 saved request could not be read. Check the conversations on the host before sending again; a request may already have run.",
            )
          : t(
              "{p0} saved requests could not be read. Check the conversations on the host before sending again; a request may already have run.",
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
        disabled={reviewed !== issue.key}

        onClick={() => {
          try {
            archiveRemoteOutboxIssue(issue.key);
            setReviewed(null);
            setError(null);
          } catch (reason) {
            setError(reason instanceof Error ? reason.message : "Could not archive the request.");
          }
        }}
        variant="secondary"
      >
        {t("Archive unreadable request")}
      </Button>
      {error ? (
        <Alert role="alert" tone="warning">
          {error}
        </Alert>
      ) : null}
    </Alert>
  );
}
