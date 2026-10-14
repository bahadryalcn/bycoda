import { SearchInput } from "../../shared/ui/SearchInput";
import { projectDisplayName } from "../../features/projects/model/projectNames";
import { useEffect, useMemo, useState } from "react";
import { t, useLocale } from "../../shared/i18n";
import { Modal } from "../../shared/ui/Modal";
import { HarnessIcon } from "../../features/sessions/ui/HarnessIcon";
import {
  sessionDisplayTitle,
  HARNESS_TITLE,
  type Session,
} from "../../features/sessions/model/session";
import { parseRemotePath } from "../../features/connections/model/remoteProjects";
import { knownRemoteMachine } from "../../features/connections/model/connections";
import type { RemoteRailSession } from "../../features/connections/model/remoteRailSessions";
import {
  recoveryStatus,
  recoveryNeedsAttention,
  recoveryStatusOrder,
  type RecoveryStatus,
  type SessionRecovery,
} from "../../features/workspace/model/sessionRecovery";
import { formatRelative } from "../../features/sessions/model/recentSessions";

import { useVisibleProjects } from "../../features/group-lock/hooks/useGroupLock";
import type { WorkspaceSessionStub } from "../../features/workspace/model/workspaceSnapshot";
import { getSession } from "../../features/sessions/data/sessionStore";
import { Trash2 } from "../../shared/ui/icons";
import "./session-recovery.css";

const stubPath = (stub: WorkspaceSessionStub) => stub.cwd;

const labels: Record<RecoveryStatus, string> = {
  working: "Working",
  input: "Needs input",
  interrupted: "Interrupted",
  done: "Done",
  idle: "Idle",
  unknown: "Status not verified",
  unavailable: "Session unavailable",
  failed: "Failed",
  retrying: "Retrying",
};
const button =
  "rounded-md border border-stroke px-3 py-1.5 text-sm enabled:hover:bg-content/8 active:bg-content/12 focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-40";

type Props = {
  recovery: SessionRecovery;
  sessions: Session[];
  remoteSessions: readonly RemoteRailSession[];
  onClose: () => void;
  onOpen: (ids: string[], restoreLayout: boolean) => Promise<void>;
  onRemove: (ids: string[]) => Promise<void>;
};

export function SessionRecoveryPanel({
  recovery,
  sessions,
  remoteSessions,
  onClose,
  onOpen,
  onRemove,
}: Props) {
  const locale = useLocale();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<"attention" | "all">("attention");
  const [stored, setStored] = useState<Map<string, Session | null | "error">>(() => new Map());
  const visible = useVisibleProjects(recovery.workspace.sessions, stubPath);
  const missingLocalIds = visible
    .filter(
      (stub) => !parseRemotePath(stub.cwd) && !sessions.some((session) => session.id === stub.id),
    )
    .map((stub) => stub.id);
  const missingLocalKey = JSON.stringify(missingLocalIds);
  useEffect(() => {
    let cancelled = false;
    const ids = JSON.parse(missingLocalKey) as string[];
    let cursor = 0;
    const results = new Map<string, Session | null | "error">();
    const worker = async () => {
      while (cursor < ids.length && !cancelled) {
        const id = ids[cursor++];
        results.set(id, await getSession(id).catch(() => "error" as const));
      }
    };
    void Promise.all(Array.from({ length: Math.min(4, ids.length) }, worker)).then(() => {
      if (!cancelled) setStored(results);
    });
    return () => {
      cancelled = true;
    };
  }, [missingLocalKey]);
  const rows = useMemo(
    () =>
      visible.map((stub) => {
        const saved = stored.get(stub.id);
        const local =
          sessions.find((session) => session.id === stub.id) ??
          (saved && saved !== "error" ? saved : undefined);
        const remote = !!parseRemotePath(stub.cwd);
        const host = remoteSessions.find(
          (entry) => entry.project === stub.cwd && entry.session.id === stub.remoteSessionId,
        );
        const status: RecoveryStatus =
          remote && host?.fresh
            ? (host.session.issue ??
              (host.session.needsInput
                ? "input"
                : host.session.status === "running"
                  ? "working"
                  : host.session.status === "interrupted"
                    ? "interrupted"
                    : "idle"))
            : !remote && saved === null && !local
              ? "unavailable"
              : recoveryStatus(local, remote, false);
        const environmentId = parseRemotePath(stub.cwd)?.environmentId;
        const machine = environmentId
          ? (knownRemoteMachine(environmentId)?.name ?? environmentId)
          : t("This computer");
        const lastTurn = local?.blocks
          .slice()
          .reverse()
          .find((block) => block.role === "user" && block.startedAt !== undefined);
        const activityAt =
          host?.session.updatedAt ??
          (lastTurn?.startedAt !== undefined
            ? lastTurn.startedAt + (lastTurn.durationMs ?? 0)
            : undefined);
        return {
          stub,
          title: sessionDisplayTitle(local?.title || stub.title, stub.harness),
          status,
          machine,
          activityAt,
        };
      }),
    [recovery, visible, sessions, remoteSessions, stored, locale],
  );
  const attentionCount = rows.filter((row) => recoveryNeedsAttention(row.status)).length;
  const shown = rows
    .filter(
      (row) =>
        (filter === "all" || recoveryNeedsAttention(row.status)) &&
        `${row.title} ${row.stub.cwd} ${row.machine} ${row.stub.model}`
          .toLocaleLowerCase()
          .includes(query.toLocaleLowerCase()),
    )
    .sort(
      (a, b) =>
        recoveryStatusOrder(a.status) - recoveryStatusOrder(b.status) ||
        (b.activityAt ?? 0) - (a.activityAt ?? 0),
    );
  const open = async (ids: string[], layout = false) => {
    setPending(true);
    setError("");
    try {
      await onOpen(ids, layout);
      onClose();
    } catch {
      setError(
        t(
          "Some sessions could not be opened. Your recovery list is preserved. Retry opening them.",
        ),
      );
    } finally {
      setPending(false);
    }
  };
  const toggle = (id: string) =>
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const selectedIds = shown.filter((row) => selected.has(row.stub.id)).map((row) => row.stub.id);
  const completedIds = rows
    .filter((row) => row.status === "done" || row.status === "idle")
    .map((row) => row.stub.id);
  const remove = async (ids: string[]) => {
    setPending(true);
    setError("");
    try {
      await onRemove(ids);
      setSelected((previous) => new Set([...previous].filter((id) => !ids.includes(id))));
    } catch {
      setError(t("Could not update the recovery list. Try again."));
    } finally {
      setPending(false);
    }
  };
  return (
    <Modal
      title={t("Recovered sessions")}
      onClose={pending ? () => {} : onClose}
      size="md"
      className="session-recovery-dialog"
      fitViewport
    >
      <div className="session-recovery flex min-h-0 flex-col gap-3 p-4" aria-busy={pending}>
        <p className="text-sm text-content/70">
          {t("Opening tabs does not restart work. Removing entries keeps conversation history.")}
        </p>
        <p className="text-sm" role="status">
          {t("{p0} previous sessions · {p1} need attention", {
            p0: rows.length,
            p1: attentionCount,
          })}
          {(["interrupted", "failed", "input", "retrying"] as const).map((status) => {
            const count = rows.filter((row) => row.status === status).length;
            return count ? (
              <span key={status}>
                {" "}
                · {count} {t(labels[status])}
              </span>
            ) : null;
          })}
        </p>
        <div className="flex flex-wrap gap-2" aria-label={t("Session filters")}>
          <button
            type="button"
            className={`${button} ${filter === "attention" ? "bg-accent/12 text-accent" : ""}`}
            aria-pressed={filter === "attention"}
            onClick={() => setFilter("attention")}
          >
            {t("Needs attention")} ({attentionCount})
          </button>
          <button
            type="button"
            className={`${button} ${filter === "all" ? "bg-accent/12 text-accent" : ""}`}
            aria-pressed={filter === "all"}
            onClick={() => setFilter("all")}
          >
            {t("All sessions")} ({rows.length})
          </button>
        </div>
        <SearchInput
          standalone
          aria-label={t("Search recovered sessions")}
          placeholder={t("Search recovered sessions")}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          containerClassName="w-full"
          className="rounded-md border border-stroke bg-content/4 px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-accent"
        />
        <div className="recovery-actions">
          <button
            className={`${button} bg-accent/12 text-accent`}
            disabled={pending || !rows.length}
            onClick={() => void open(rows.map((row) => row.stub.id))}
          >
            {t("Open all")} ({rows.length})
          </button>
          {selectedIds.length ? (
            <>
              <button className={button} disabled={pending} onClick={() => void open(selectedIds)}>
                {t("Open selected")} ({selectedIds.length})
              </button>
              <button
                className={button}
                disabled={pending}
                onClick={() => void remove(selectedIds)}
              >
                {t("Remove selected")}
              </button>
            </>
          ) : null}
        </div>
        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}
        <ul
          className="recovery-list min-h-0 overflow-y-auto overscroll-contain divide-y divide-stroke"
          aria-label={t("Recovered sessions")}
        >
          {shown.map(({ stub, title, status, machine, activityAt }) => (
            <li key={stub.id} className="recovery-row flex items-center gap-2 py-3">
              <input
                type="checkbox"
                checked={selected.has(stub.id)}
                disabled={pending}
                aria-label={t("Select {p0}", { p0: title })}
                onChange={() => toggle(stub.id)}
              />
              <HarnessIcon harness={stub.harness} className="size-4 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium" title={title}>
                  {title}
                </div>
                <div
                  className="truncate text-xs text-content/60"
                  title={`${stub.cwd} · ${HARNESS_TITLE[stub.harness]} ${stub.model}`}
                >
                  {projectDisplayName(stub.cwd)} · {machine}
                </div>
                <div className="text-xs text-content/70">
                  <span
                    className={
                      status === "failed"
                        ? "font-medium text-danger"
                        : status === "interrupted" || status === "input" || status === "retrying"
                          ? "font-medium text-warning"
                          : status === "working"
                            ? "font-medium text-accent"
                            : status === "done"
                              ? "text-success"
                              : ""
                    }
                  >
                    {t(labels[status])}
                  </span>{" "}
                  ·{" "}
                  {activityAt
                    ? t("Last activity {p0}", { p0: formatRelative(activityAt, Date.now()) })
                    : t("Recovered {p0}", { p0: formatRelative(recovery.capturedAt, Date.now()) })}
                </div>
              </div>
              <button className={button} disabled={pending} onClick={() => void open([stub.id])}>
                {t("Open")}
              </button>
              <button
                className="recovery-remove"
                disabled={pending}
                aria-label={t("Remove {p0} from recovery list", { p0: title })}
                title={t("Remove from recovery list")}
                onClick={() => void remove([stub.id])}
              >
                <Trash2 className="size-4" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
        {!shown.length ? (
          <p className="text-sm text-content/60">
            {t(
              filter === "attention" && !query
                ? "No sessions need recovery."
                : "No matching sessions",
            )}
          </p>
        ) : null}
        <div className="recovery-actions border-t border-stroke pt-3">
          <button
            className={button}
            disabled={pending || !rows.length}
            onClick={() =>
              void open(
                rows.map((row) => row.stub.id),
                true,
              )
            }
          >
            {t("Restore previous layout")}
          </button>
          <button
            className={button}
            disabled={pending || !completedIds.length}
            onClick={() => void remove(completedIds)}
          >
            {t("Clear completed")}
          </button>
          <button
            className={button}
            disabled={pending || !rows.length}
            onClick={() => void remove(rows.map((row) => row.stub.id))}
          >
            {t("Clear list")}
          </button>
        </div>
      </div>
    </Modal>
  );
}
