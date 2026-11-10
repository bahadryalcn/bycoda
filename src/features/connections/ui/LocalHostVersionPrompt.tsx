import { useState } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { ConfirmDialog, type ConfirmRequest } from "../../../shared/ui/ConfirmDialog";
import { updateBundledHostNow, useBundledHostStatus } from "../model/bundledHostStatus";
import { localHostVersionMismatch } from "../model/localHostNotice";

/**
 * Asks the owner, wherever they are in the app, to bring the app and this computer's Host to
 * the same version when the two differ. An older Host is stopped and replaced by the bundled
 * one after the owner confirms the interruption; a newer Host needs a newer app, which
 * `onUpdateApp` starts. "Not now" keeps the prompt away until the app restarts.
 */
export function LocalHostVersionPrompt({
  onUpdateApp,
}: {
  /** Runs the app's own update flow; without it a newer Host is not prompted for. */
  onUpdateApp?: () => Promise<void>;
}) {
  useLocale();
  const status = useBundledHostStatus();
  const [postponed, setPostponed] = useState<string>();
  const mismatch = localHostVersionMismatch(status);
  if (!mismatch || (mismatch.update === "app" && !onUpdateApp)) return null;
  const key = `${mismatch.installed}>${mismatch.bundled}`;
  if (postponed === key) return null;
  const versions = t("This computer's host is {p0}; this app includes {p1}.", {
    p0: mismatch.installed,
    p1: mismatch.bundled,
  });
  const sameVersion = {
    content: t("The app and the host must be the same version to work reliably."),
  };
  const request: ConfirmRequest =
    mismatch.update === "app"
      ? {
          title: t("Update this app now?"),
          message: versions,
          consequences: [
            { content: t("This computer's host is newer than the one this app includes.") },
            sameVersion,
          ],
          danger: false,
          confirmLabel: t("Update app"),
          cancelLabel: t("Not now"),
          onConfirm: () => onUpdateApp?.(),
        }
      : {
          title: t("Update this computer's host now?"),
          message: versions,
          consequences: [
            sameVersion,
            {
              tone: "warning",
              content: t("Running sessions and shells on this computer are interrupted."),
            },
            { content: t("Session history is kept.") },
          ],
          confirmLabel: t("Stop and update"),
          cancelLabel: t("Not now"),
          pendingLabel: t("Updating host…"),
          onConfirm: async () => {
            const result = await updateBundledHostNow();
            if (result?.state === "failed" || result?.state === "deferred")
              throw new Error(
                t(result.message ?? "The host on this computer could not be updated."),
              );
          },
        };
  return <ConfirmDialog key={key} request={request} onSettle={() => setPostponed(key)} />;
}
