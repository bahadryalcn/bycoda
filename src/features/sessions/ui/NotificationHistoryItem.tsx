import { Timestamp } from "../../../shared/ui/Timestamp";
import { useRef, useState } from "react";
import { useT } from "../../../shared/i18n";
import { pathKey, prettyCwd, projectName } from "../../../shared/lib/paths";
import { ActionHost } from "../../../shared/ui/ActionHost";
import { Alert } from "../../../shared/ui/Alert";
import { Button } from "../../../shared/ui/Button";
import { Disclosure } from "../../../shared/ui/Disclosure";
import { useNotificationProjects } from "../../notifications/hooks/useNotificationProjects";
import type { NotificationHistoryEntry } from "../../notifications/model/notificationHistory";
import { HARNESS_LABEL, sessionDisplayTitle, type HarnessId } from "../model/session";

/** Same date-and-time wording in Pending rows and History rows. */
export function NotificationTime({ at }: { at: number }) {
  return (
    <>
      <Timestamp value={at} format="date" />
      {" · "}
      <Timestamp value={at} format="time" />
    </>
  );
}

/** The conversation title without the provider prefix stored for the tab strip. */
function historyTitle(entry: NotificationHistoryEntry): string {
  const harnesses = entry.harness ? [entry.harness] : (Object.keys(HARNESS_LABEL) as HarnessId[]);
  for (const harness of harnesses) {
    if (!HARNESS_LABEL[harness]) continue;
    const title = sessionDisplayTitle(entry.title, harness);
    if (title !== entry.title) return title;
  }
  return entry.title;
}

/** A recorded arrival. It is never a live approval: it only reads and, when allowed, opens its conversation. */
export function HistoryItem({
  entry,
  canOpen,
  onOpen,
}: {
  entry: NotificationHistoryEntry;
  canOpen: boolean;
  onOpen: (entry: NotificationHistoryEntry) => Promise<void>;
}) {
  const t = useT();
  const [opening, setOpening] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const open = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setOpening(true);
    setOpenError(null);
    try {
      await onOpen(entry);
    } catch (error) {
      setOpenError(
        error instanceof Error && error.message
          ? error.message
          : t("This conversation is no longer available."),
      );
    } finally {
      inFlight.current = false;
      setOpening(false);
    }
  };
  return (
    <ActionHost as="article" className="notification-history-item block">
      <Disclosure
        variant="row"
        className="notification-history-details"
        summary={
          <>
            <span className="notification-history-title">
              {historyTitle(entry) || t("Untitled")}
            </span>
            <span className="notification-history-preview">{entry.label}</span>
          </>
        }
      >
        <p className="notification-history-label">{entry.label}</p>
        <p className="notification-history-path" title={entry.cwd}>
          {prettyCwd(entry.cwd)}
        </p>
      </Disclosure>
      <div className="notification-history-meta" data-no-drag="">
        <NotificationProjectLabel cwd={entry.cwd} />
        <span>{entry.kind === "question" ? t("Question") : t("Approval")}</span>
        <NotificationTime at={entry.occurredAt} />
        {canOpen ? (
          <Button
            variant="ghost"
            size="sm"
            type="button"
            loading={opening}
            onClick={() => void open()}
          >
            {t("Open session")}
          </Button>
        ) : null}
      </div>
      {openError ? (
        <Alert tone="warning" className="mt-1">
          {openError}
        </Alert>
      ) : null}
    </ActionHost>
  );
}

export function NotificationProjectLabel({ cwd }: { cwd: string }) {
  const project = useNotificationProjects([cwd]).projects.find((project) =>
    project.paths.some((path) => pathKey(path) === pathKey(cwd)),
  );
  return (
    <span className="notification-project" title={cwd}>
      <span className="notification-project-name">{project?.name || projectName(cwd)}</span>
      <span className="notification-project-path sr-only">{prettyCwd(cwd)}</span>
    </span>
  );
}
