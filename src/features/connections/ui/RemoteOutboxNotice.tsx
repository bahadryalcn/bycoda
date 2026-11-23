import { Alert } from "../../../shared/ui/Alert";
import { ConfirmMorph } from "../../../shared/ui/ConfirmMorph";
import { ErrorDetails } from "../../../shared/ui/ErrorDetails";
import { useDelayedVisible } from "../../../shared/hooks/useDelayedVisible";
import { t, useLocale } from "../../../shared/i18n";
import { LoadingText } from "../../../shared/ui/LoadingText";
import { useState } from "react";
import {
  archiveDurableRemoteOutboxIssue,
  useDurableRemoteOutboxIssues,
} from "../model/remoteOutbox";
import { exportOversizedOutboxRecord } from "../model/remoteOutboxDatabase";
import { errorText } from "../../../shared/lib/errors";

export function RemoteOutboxNotice({
  project,
  environment,
}: {
  project?: string;
  environment?: string;
}) {
  useLocale();
  const issues = useDurableRemoteOutboxIssues(project, environment);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [exportedFor, setExportedFor] = useState<string | null>(null);
  const checking = issues[0]?.loading === true;
  const checkingShown = useDelayedVisible(checking);
  if (!issues.length) return null;
  const issue = issues[0];
  // Checking is not a warning: say nothing unless it takes long, then say it quietly.
  if (checking)
    return checkingShown ? (
      <LoadingText delay={false}>{t("Checking saved requests…")}</LoadingText>
    ) : null;
  if (issue.unavailable) {
    const record = issue.oversizedRecord;
    return (
      <Alert
        tone="warning"
        action={
          record
            ? {
                label: t("Export saved request"),
                disabled: saving,
                onClick: () => {
                  setSaving(true);
                  setError(null);
                  void exportOversizedOutboxRecord(record)
                    .then((result) => {
                      if (!result.cancelled) setExportedFor(`${record.key}:${record.version}`);
                    })
                    .catch((cause: unknown) => setError(errorText(cause)))
                    .finally(() => setSaving(false));
                },
              }
            : undefined
        }
        extra={error ? <ErrorDetails detail={error} /> : undefined}
      >
        {issue.oversized
          ? t(
              "A saved request is too large to read safely. Its original bytes are preserved and sending is held.",
            )
          : t("Saved requests cannot be read. Sending is held until storage is available.")}
        {record && exportedFor === `${record.key}:${record.version}`
          ? ` ${t("Saved request exported.")}`
          : ""}
      </Alert>
    );
  }
  return (
    <Alert
      tone="warning"
      title={t("An unfinished request needs recovery")}
      extra={
        <ConfirmMorph
          label={t("Archive reviewed request")}
          confirmLabel={t("Archive")}
          pendingLabel={t("Archiving…")}
          doneLabel={t("Archived")}
          errorLabel={t("Could not archive the request.")}
          onConfirm={() => archiveDurableRemoteOutboxIssue(issue.key)}
        />
      }
    >
      {issues.length === 1
        ? t(
            "1 saved request could not be safely reconciled. Check the conversations on the host before sending again; a request may already have run.",
          )
        : t(
            "{p0} saved requests could not be safely reconciled. Check the conversations on the host before sending again; a request may already have run.",
            { p0: issues.length },
          )}
    </Alert>
  );
}
