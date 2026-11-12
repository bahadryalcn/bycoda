import { EmptyState } from "../../../shared/ui/EmptyState";
import { useEffect, useRef, useState } from "react";
import { Badge } from "../../../shared/ui/Badge";
import { Button } from "../../../shared/ui/Button";
import { Disclosure } from "../../../shared/ui/Disclosure";
import { InlineError } from "../../../shared/ui/InlineError";
import { MiddleTruncate } from "../../../shared/ui/MiddleTruncate";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { t } from "../../../shared/i18n";
import type {
  AssistantRequest,
  AssistantResponse,
} from "../../../shared/model/host-contracts/assistant";
import { useAssistantControlSource } from "../model/useAssistantControlSource";
import rt from "./room/RoomTabs.module.css";

type Row = NonNullable<AssistantResponse["observationDeliveries"]>[number];
export function AssistantNotificationRecovery({
  projects,
  environmentId,
  request,
}: {
  projects: readonly { id?: string; name: string }[];
  environmentId: string;
  request: (input: AssistantRequest, environmentId: string) => Promise<AssistantResponse>;
}) {
  const [choice, setChoice] = useState("");
  const [selected, setSelected] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [threadId, setThreadId] = useState<string>();
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const epoch = useRef(0);
  const bound = useRef({ environmentId, projects });
  bound.current = { environmentId, projects };
  const source = useAssistantControlSource(
    expanded ? threadId : undefined,
    expanded ? environmentId : undefined,
  );
  useEffect(
    () => () => {
      epoch.current++;
    },
    [],
  );
  useEffect(() => {
    if (!expanded) {
      setThreadId(undefined);
      return;
    }
    let active = true;
    void request({ op: "threads.open" }, environmentId)
      .then((result) => {
        if (!result.thread || result.thread.projectId)
          throw new Error("Global Room source unavailable.");
        if (active) setThreadId(result.thread.id);
      })
      .catch((cause) => {
        if (active) setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      active = false;
    };
  }, [expanded, environmentId]);
  async function read(projectId: string, notificationId?: string) {
    if (busy || !bound.current.projects.some((project) => project.id === projectId)) return;
    const sequence = ++epoch.current,
      host = environmentId;
    setBusy(true);
    setError("");
    if (selected !== projectId) setRows([]);
    setSelected(projectId);
    try {
      const result = await request(
        notificationId
          ? { op: "observation.delivery.refresh", projectId, notificationId }
          : { op: "observation.delivery.list", projectId },
        host,
      );
      if (
        sequence !== epoch.current ||
        bound.current.environmentId !== host ||
        !bound.current.projects.some((project) => project.id === projectId)
      )
        return;
      if (notificationId)
        setRows((previous) =>
          previous.map((row) =>
            row.notificationId === notificationId
              ? (result.observationDeliveries?.[0] ?? row)
              : row,
          ),
        );
      else setRows(result.observationDeliveries ?? []);
    } catch (cause) {
      if (
        sequence === epoch.current &&
        bound.current.environmentId === host &&
        bound.current.projects.some((project) => project.id === projectId)
      )
        setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (sequence === epoch.current) setBusy(false);
    }
  }
  const projectOptions = projects
    .filter((project) => project.id)
    .map((project) => ({ value: project.id!, label: project.name }));
  const stateLabel = (state: Row["state"]) =>
    state === "pending"
      ? t("Status pending")
      : state === "unknown"
        ? t("Outcome unknown")
        : state === "accepted"
          ? t("Native queue accepted; display not confirmed")
          : t("Notification suppressed");
  return (
    <Disclosure size="sm" summary={t("Task notification recovery")} onOpenChange={setExpanded}>
      <div className={rt.disclosureBody}>
        <p>{t("Check the original notification status. This never sends it again.")}</p>
        {expanded && source === "pending" && <p>{t("Checking Room registration…")}</p>}
        {source === "unavailable" && (
          <InlineError>
            {t("Room registration is unavailable. Reopen the Room to retry.")}
          </InlineError>
        )}
        <div className={rt.recoveryForm}>
          <SearchableSelect
            label={t("Project")}
            placeholder={t("Select project")}
            value={choice}
            options={projectOptions}
            disabled={busy || source !== "registered"}
            onChange={setChoice}
          />
          <Button
            variant="secondary"
            size="sm"
            disabled={!choice || busy || source !== "registered"}
            onClick={() => {
              void read(choice).catch((cause) =>
                setError(cause instanceof Error ? cause.message : String(cause)),
              );
            }}
          >
            {t("Check notifications")}
          </Button>
        </div>
        {error ? <InlineError>{error}</InlineError> : null}
        {selected && !busy && !error && rows.length === 0 ? (
          <EmptyState
            size="inline"
            kind="empty"
            description={t("No pending task notifications for this project.")}
          />
        ) : null}
        {rows.map((row) => (
          <div key={row.notificationId} className={rt.recoveryRow}>
            <MiddleTruncate className={rt.recoveryId}>{row.notificationId}</MiddleTruncate>
            <Badge size="xs" tone={row.state === "unknown" ? "danger" : "neutral"}>
              {stateLabel(row.state)}
            </Badge>
            {(row.state === "pending" || row.state === "unknown") && (
              <Button
                variant="secondary"
                size="sm"
                disabled={busy}
                onClick={() => {
                  void read(row.projectId, row.notificationId).catch((cause) =>
                    setError(cause instanceof Error ? cause.message : String(cause)),
                  );
                }}
              >
                {t("Check original status")}
              </Button>
            )}
          </div>
        ))}
      </div>
    </Disclosure>
  );
}
