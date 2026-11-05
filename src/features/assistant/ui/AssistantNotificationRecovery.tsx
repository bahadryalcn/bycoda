import { useEffect, useRef, useState } from "react";
import { Button } from "../../../shared/ui/Button";
import { InlineError } from "../../../shared/ui/InlineError";
import { t } from "../../../shared/i18n";
import type {
  AssistantRequest,
  AssistantResponse,
} from "../../../shared/model/host-contracts/assistant";
import { useAssistantControlSource } from "../model/useAssistantControlSource";

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
  return (
    <details onToggle={(event) => setExpanded(event.currentTarget.open)}>
      <summary>{t("Task notification recovery")}</summary>
      <p>{t("Check the original notification status. This never sends it again.")}</p>
      {expanded && source === "pending" && <p>{t("Checking Room registration…")}</p>}
      {source === "unavailable" && (
        <InlineError>
          {t("Room registration is unavailable. Reopen the Room to retry.")}
        </InlineError>
      )}
      {projects
        .filter((project) => project.id)
        .map((project) => (
          <Button
            key={project.id}
            variant="ghost"
            size="sm"
            disabled={busy || source !== "registered"}
            onClick={() => {
              void read(project.id!).catch((cause) =>
                setError(cause instanceof Error ? cause.message : String(cause)),
              );
            }}
          >
            {project.name}
          </Button>
        ))}
      {error ? <InlineError>{error}</InlineError> : null}
      {selected && !busy && !error && rows.length === 0 ? (
        <p>{t("No pending task notifications for this project.")}</p>
      ) : null}
      {rows.map((row) => (
        <div key={row.notificationId}>
          <span>
            {row.notificationId} ·{" "}
            {row.state === "pending"
              ? t("Status pending")
              : row.state === "unknown"
                ? t("Outcome unknown")
                : row.state === "accepted"
                  ? t("Native queue accepted; display not confirmed")
                  : t("Notification suppressed")}
          </span>{" "}
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
    </details>
  );
}
