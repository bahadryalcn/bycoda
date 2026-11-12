import { Text } from "../../../shared/ui/Text";
import { useT } from "../../../shared/i18n";
import { useEffect, useState } from "react";
import { prettyCwd } from "../../../shared/lib/paths";
import { projectSessionCount } from "../model/projectData";
import { useProjectConfirmDialog } from "../hooks/useProjectConfirmDialog";
import { Alert } from "../../../shared/ui/Alert";
import type { ConfirmRequest } from "../../../shared/ui/ConfirmDialog";
import { InlineError } from "../../../shared/ui/InlineError";
import { LoadingText } from "../../../shared/ui/LoadingText";

type Props = {
  name: string;
  path: string;
  paths?: string[];
  confirmDisabled?: boolean;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
};

/**
 * Delete drops the project from the rail and its saved chats. The folder on
 * disk is left alone; opening it again brings the project back empty.
 */
export function RemoveProjectDialog({
  name,
  path,
  paths,
  confirmDisabled,
  onCancel,
  onConfirm,
}: Props) {
  const t = useT();
  const [sessions, setSessions] = useState<number | null>(null);
  const [countError, setCountError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setSessions(null);
    setCountError(null);
    void Promise.all((paths ?? [path]).map(projectSessionCount)).then(
      (counts) => {
        if (!cancelled) setSessions(counts.reduce((sum, count) => sum + count, 0));
      },
      (reason: unknown) => {
        if (!cancelled) setCountError(reason instanceof Error ? reason.message : String(reason));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [path, paths, revision]);

  const request: ConfirmRequest = {
    title: t("Delete {p0}", { p0: name }),
    message: paths
      ? t(
          "All conversations for the selected projects will be deleted. The projects leave the sidebar. Their folders on disk stay put.",
        )
      : t(
          "All conversations for this project will be deleted. It also leaves the sidebar. The folder on disk stays put, and opening it again brings the project back empty.",
        ),
    confirmLabel: t("Delete"),
    pendingLabel: t("Deleting…"),
    confirmDisabled: Boolean(confirmDisabled) || sessions == null || countError != null,
    consequences:
      sessions != null && sessions > 0
        ? [
            {
              tone: "danger",
              content:
                sessions === 1
                  ? t("1 saved conversation will be removed.")
                  : t("{p0} saved conversations will be removed.", { p0: sessions }),
            },
          ]
        : undefined,
    details: (
      <Text as="div" size="micro" tone="muted" leading="tight" className="max-h-40 overflow-y-auto">
        {(paths ?? [path]).map((entry) => (
          <p key={entry} className="break-all">
            {prettyCwd(entry)}
          </p>
        ))}
      </Text>
    ),
    body: (
      <>
        {countError ? (
          <InlineError retry={{ onRetry: () => setRevision((value) => value + 1) }}>
            {countError}
          </InlineError>
        ) : sessions == null ? (
          <LoadingText>{t("Loading…")}</LoadingText>
        ) : null}
        {confirmDisabled ? (
          <Alert tone="danger">
            {t(
              "Selection changed or a project is working. Close this dialog and review your selection.",
            )}
          </Alert>
        ) : null}
      </>
    ),
    onConfirm: async () => {
      try {
        await onConfirm();
      } catch (reason) {
        setRevision((value) => value + 1);
        throw reason;
      }
    },
  };
  return useProjectConfirmDialog(request, onCancel);
}
