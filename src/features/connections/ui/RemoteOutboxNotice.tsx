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
    <section
      role="alert"
      className="shrink-0 space-y-2 border-b border-stroke bg-content/5 px-4 py-3 text-xs text-content"
    >
      <p className="font-medium">{t("An unfinished request needs recovery")}</p>
      <p className="leading-relaxed text-content/75">
        {issues.length}
        {t(" saved request")}
        {issues.length === 1 ? "" : "s"}
        {t(
          " could not be read. Check the conversations on the host before sending again; a request may already have run.",
        )}
      </p>
      <p className="break-all text-content/75">
        {t("Project: ")}
        {issue.project}
      </p>
      <label className="flex items-start gap-2">
        <input
          type="checkbox"
          checked={reviewed === issue.key}
          onChange={(event) => setReviewed(event.target.checked ? issue.key : null)}
        />
        {t("I checked the host and understand that this request will not be retried.")}
      </label>
      <button
        type="button"
        disabled={reviewed !== issue.key}
        className="rounded border border-content/25 px-3 py-1.5 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-accent"
        onClick={() => {
          try {
            archiveRemoteOutboxIssue(issue.key);
            setReviewed(null);
            setError(null);
          } catch (reason) {
            setError(reason instanceof Error ? reason.message : "Could not archive the request.");
          }
        }}
      >
        {t("Archive unreadable request")}
      </button>
      {error ? <p role="alert">{error}</p> : null}
    </section>
  );
}
