import { Alert } from "../../shared/ui/Alert";
import { SegmentedControl } from "../../shared/ui/SegmentedControl";
import { Checkbox } from "../../shared/ui/Checkbox";
import { Button } from "../../shared/ui/Button";
import { ActionHost, InlineAction } from "../../shared/ui/ActionHost";
import { SearchInput, SearchInputGroup } from "../../shared/ui/SearchInput";
import { projectDisplayName } from "../../features/projects/model/projectNames";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocale, useT } from "../../shared/i18n";
import { Modal } from "../../shared/ui/Modal";
import { HarnessIcon } from "../../features/sessions/ui/HarnessIcon";
import {
  sessionDisplayTitle,
  HARNESS_TITLE,
  type Session,
} from "../../features/sessions/model/session";
import { parseRemotePath } from "../../features/connections/model/remoteProjects";
import { knownRemoteMachine, remoteSessionFor } from "../../features/connections/model/connections";
import type { RemoteRailSession } from "../../features/connections/model/remoteRailSessions";
import {
  recoveryStatus,
  recoveryNeedsAttention,
  recoveryStatusOrder,
  eligibleRecoverySessions,
  RecoveryOpenError,
  type RecoveryStatus,
  type SessionRecovery,
} from "../../features/workspace/model/sessionRecovery";
import { formatRelative } from "../../features/sessions/model/recentSessions";

import { useVisibleProjects } from "../../features/group-lock/hooks/useGroupLock";
import type { WorkspaceSessionStub } from "../../features/workspace/model/workspaceSnapshot";
import { getSession } from "../../features/sessions/data/sessionStore";
import { Search, Trash2 } from "../../shared/ui/icons";
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

type Props = {
  recovery: SessionRecovery;
  sessions: Session[];
  remoteSessions: readonly RemoteRailSession[];
  onClose: () => void;
  onOpen: (ids: string[], restoreLayout: boolean) => Promise<void>;
  onRemove: (ids: string[]) => Promise<void>;
  /** Keeps the existing conversation workflow inside the shared recovery shell. */
  renderContainer?: (content: ReactNode, pending: boolean) => ReactNode;
};

export function SessionRecoveryPanel({
  recovery,
  sessions,
  remoteSessions,
  onClose,
  onOpen,
  onRemove,
  renderContainer,
}: Props) {
  const t = useT();
  const locale = useLocale();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [pending, setPending] = useState(false);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const pendingRef = useRef(false);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<"attention" | "all">("attention");
  const [stored, setStored] = useState<Map<string, Session | null | "error">>(() => new Map());
  const [readErrors, setReadErrors] = useState<Map<string, string>>(() => new Map());
  const [readAttempt, setReadAttempt] = useState(0);
  const [openOutcome, setOpenOutcome] = useState<RecoveryOpenError | null>(null);
  const lockVisible = useVisibleProjects(recovery.workspace.sessions, stubPath);
  // A remote chat whose host session is already open in a tab is not unopened work.
  const visible = useMemo(
    () =>
      eligibleRecoverySessions(
        { ...recovery, workspace: { ...recovery.workspace, sessions: lockVisible } },
        sessions,
        () => false,
        remoteSessionFor,
      ),
    [recovery, lockVisible, sessions],
  );
  const missingLocalIds = visible
    .filter(
      (stub) => !parseRemotePath(stub.cwd) && !sessions.some((session) => session.id === stub.id),
    )
    .map((stub) => stub.id);
  const missingLocalKey = JSON.stringify(missingLocalIds);
  useEffect(() => {
    let cancelled = false;
    const ids = (JSON.parse(missingLocalKey) as string[]).filter((id) => !stored.has(id));
    let cursor = 0;
    const results = new Map<string, Session | null | "error">();
    const worker = async () => {
      while (cursor < ids.length && !cancelled) {
        const id = ids[cursor++];
        try {
          results.set(id, await getSession(id));
        } catch (cause) {
          results.set(id, "error");
          if (!cancelled)
            setReadErrors((previous) =>
              new Map(previous).set(id, cause instanceof Error ? cause.message : String(cause)),
            );
        }
      }
    };
    void Promise.all(Array.from({ length: Math.min(4, ids.length) }, worker)).then(() => {
      if (!cancelled) setStored((previous) => new Map([...previous, ...results]));
    });
    return () => {
      cancelled = true;
    };
  }, [missingLocalKey, readAttempt]);
  const retryRead = (id: string) => {
    setStored((previous) => {
      const next = new Map(previous);
      next.delete(id);
      return next;
    });
    setReadAttempt((attempt) => attempt + 1);
  };
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
          verification: remote
            ? host?.fresh
              ? ""
              : t("Remote status is not verified.")
            : local
              ? ""
              : saved === "error"
                ? t("Could not verify this session.")
                : saved === null
                  ? t("Session unavailable")
                  : t("Checking saved session…"),
          readError:
            saved === "error"
              ? readErrors.get(stub.id) || t("Could not verify this session.")
              : undefined,
        };
      }),
    [recovery, visible, sessions, remoteSessions, stored, readErrors, locale],
  );
  const attentionCount = rows.filter((row) => recoveryNeedsAttention(row.status)).length;
  const shown = rows
    .filter(
      (row) =>
        (filter === "all" || recoveryNeedsAttention(row.status)) &&
        `${row.title} ${projectDisplayName(row.stub.cwd)} ${row.stub.cwd} ${row.machine} ${row.stub.model}`
          .toLocaleLowerCase()
          .includes(query.toLocaleLowerCase()),
    )
    .sort(
      (a, b) =>
        recoveryStatusOrder(a.status) - recoveryStatusOrder(b.status) ||
        (b.activityAt ?? 0) - (a.activityAt ?? 0),
    );
  const open = async (ids: string[], layout = false, action = "open-selected") => {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPendingAction(action);
    setPending(true);
    setError("");
    setOpenOutcome(null);
    try {
      await onOpen(ids, layout);
      onClose();
    } catch (cause) {
      if (cause instanceof RecoveryOpenError) {
        setOpenOutcome(cause);
        setError(
          cause.acknowledgmentFailed
            ? t("Conversation tabs are open, but the recovery update could not be saved.")
            : t("Some recovery entries could not be opened."),
        );
      } else setError(t("Recovery could not finish. Check the open tabs before retrying."));
    } finally {
      pendingRef.current = false;
      setPendingAction(null);
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
  const hiddenSelectedCount = rows.filter(
    (row) => selected.has(row.stub.id) && !selectedIds.includes(row.stub.id),
  ).length;
  const completedIds = rows
    .filter((row) => row.status === "done" || row.status === "idle")
    .map((row) => row.stub.id);
  const remove = async (ids: string[], action: string) => {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPendingAction(action);
    setPending(true);
    setError("");
    try {
      await onRemove(ids);
      setSelected((previous) => new Set([...previous].filter((id) => !ids.includes(id))));
    } catch {
      setError(t("Could not update the recovery list. Try again."));
    } finally {
      pendingRef.current = false;
      setPendingAction(null);
      setPending(false);
    }
  };
  const content = (
    <div className="session-recovery flex min-h-0 flex-col gap-2 p-3" aria-busy={pending}>
      <p className="text-ui-caption text-(--ui-text-secondary)">
        {t("Opening tabs does not restart work. Removing entries keeps conversation history.")}
      </p>
      <p className="text-ui-secondary" role="status">
        {t("{p0} previous sessions · {p1} need attention", {
          p0: rows.length,
          p1: attentionCount,
        })}
      </p>
      <SegmentedControl
        label={t("Session filters")}
        value={filter}
        onValueChange={(value) => setFilter(value as "attention" | "all")}
        options={[
          { value: "attention", label: t("Needs attention"), accessory: attentionCount },
          { value: "all", label: t("All sessions"), accessory: rows.length },
        ]}
      />
      <SearchInputGroup appearance="field">
        <Search className="size-3.5 shrink-0" aria-hidden="true" />
        <SearchInput
          focusOwner="group"
          aria-label={t("Search recovered sessions")}
          placeholder={t("Search recovered sessions")}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </SearchInputGroup>
      <div
        role="status"
        className="flex flex-wrap items-center gap-2 text-ui-caption text-(--ui-text-secondary)"
      >
        <span>{t("{p0} matching", { p0: shown.length })}</span>
        {selected.size > 0 ? (
          <>
            <span>{t("{p0} selected in this view", { p0: selectedIds.length })}</span>
            {hiddenSelectedCount > 0 ? (
              <span>{t("{p0} selected outside this view", { p0: hiddenSelectedCount })}</span>
            ) : null}
            <Button
              variant="ghost"
              size="sm"
              disabled={pending}
              onClick={() => setSelected(new Set())}
            >
              {t("Clear selection")}
            </Button>
          </>
        ) : null}
      </div>
      <div className="recovery-actions">
        <Button
          variant="secondary"
          size="sm"
          motion="none"
          disabled={pending || !rows.length}
          loading={pendingAction === "open-all"}
          title={t("Includes recovered sessions hidden by search or filters.")}
          onClick={() =>
            void open(
              rows.map((row) => row.stub.id),
              false,
              "open-all",
            )
          }
        >
          {t("Open all")} ({rows.length})
        </Button>
        {selectedIds.length ? (
          <>
            <Button
              variant="secondary"
              size="sm"
              motion="none"
              disabled={pending}
              loading={pendingAction === "open-selected"}
              onClick={() => void open(selectedIds)}
            >
              {t("Open selected")} ({selectedIds.length})
            </Button>
            <Button
              variant="secondary"
              size="sm"
              motion="none"

              disabled={pending}
              loading={pendingAction === "remove-selected"}
              onClick={() => void remove(selectedIds, "remove-selected")}
            >
              {t("Remove selected")}
            </Button>
          </>
        ) : null}
      </div>
      {error ? (
        <Alert tone="danger" role="alert">
          {error}
          {openOutcome ? (
            <div className="mt-1 flex flex-wrap items-center gap-2 text-ui-caption">
              <span>
                {t("{p0} opened · {p1} already open · {p2} remaining", {
                  p0: openOutcome.opened.length,
                  p1: openOutcome.alreadyOpen.length,
                  p2: openOutcome.failed.length,
                })}
              </span>
              <Button
                variant="ghost"
                size="sm"
                disabled={pending}
                loading={pendingAction === "retry-open"}
                onClick={() =>
                  void open(
                    openOutcome.acknowledgmentFailed
                      ? [...openOutcome.opened, ...openOutcome.alreadyOpen, ...openOutcome.failed]
                      : openOutcome.failed,
                    false,
                    "retry-open",
                  )
                }
              >
                {t("Retry")}
              </Button>
            </div>
          ) : null}
        </Alert>
      ) : null}
      <ul
        className="recovery-list min-h-0 overflow-y-auto overscroll-contain divide-y divide-stroke"
        aria-label={t("Recovered sessions")}
      >
        {shown.map(({ stub, title, status, machine, activityAt, verification, readError }) => (
          <li key={stub.id}>
            <ActionHost
              selected={selected.has(stub.id)}
              className="recovery-row flex flex-wrap items-start gap-2 py-2"
            >
              <Checkbox
                checked={selected.has(stub.id)}
                disabled={pending}
                aria-label={t("Select {p0}", { p0: title })}
                onChange={() => toggle(stub.id)}
              />
              <HarnessIcon harness={stub.harness} className="size-4 shrink-0" />
              <div className="min-w-0 basis-48 flex-1">
                <div className="break-words text-ui-secondary font-medium" title={title}>
                  {title}
                </div>
                <details
                  className="break-words text-ui-caption text-(--ui-text-secondary)"
                  title={`${stub.cwd} · ${HARNESS_TITLE[stub.harness]} ${stub.model}`}
                >
                  <summary className="cursor-pointer">
                    {projectDisplayName(stub.cwd)} · {machine}
                  </summary>
                  <p className="select-text [overflow-wrap:anywhere]">{stub.cwd}</p>
                  <p>
                    {HARNESS_TITLE[stub.harness]} · {stub.model}
                  </p>
                </details>
                <div className="text-ui-caption text-(--ui-text-secondary)">
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
                {verification ? (
                  <div className="break-words text-ui-caption text-(--ui-text-secondary)">
                    <span>{verification}</span>
                    {readError ? (
                      <>
                        <details>
                          <summary>{t("Details")}</summary>
                          <p className="select-text [overflow-wrap:anywhere]">{readError}</p>
                        </details>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={pending}
                          onClick={() => retryRead(stub.id)}
                        >
                          {t("Retry verification")}
                        </Button>
                      </>
                    ) : null}
                  </div>
                ) : null}
                {openOutcome?.failed.includes(stub.id) ? (
                  <p className="text-ui-caption text-danger">{t("Could not open this session.")}</p>
                ) : null}
              </div>
              <Button
                variant="secondary"
                size="sm"
                motion="none"
                disabled={pending}
                loading={pendingAction === `open:${stub.id}`}
                onClick={() => void open([stub.id], false, `open:${stub.id}`)}
              >
                {t("Open")}
              </Button>
              <InlineAction
                reveal="always"
                label={t("Remove {p0} from recovery list", { p0: title })}
                motion="none"
                className="recovery-remove"
                disabled={pending}
                loading={pendingAction === `remove:${stub.id}`}
                aria-label={t("Remove {p0} from recovery list", { p0: title })}
                title={t("Remove from recovery list")}
                onClick={() => void remove([stub.id], `remove:${stub.id}`)}
              >
                <Trash2 className="size-4" aria-hidden="true" />
              </InlineAction>
            </ActionHost>
          </li>
        ))}
      </ul>
      {!shown.length ? (
        <p role="status" className="text-ui-secondary text-(--ui-text-secondary)">
          {t(
            filter === "attention" && !query
              ? "No sessions need recovery."
              : "No matching sessions",
          )}
        </p>
      ) : null}
      <div className="recovery-actions border-t border-stroke pt-3">
        <Button
          variant="secondary"
          size="sm"
          motion="none"

          disabled={pending || !rows.length}
          loading={pendingAction === "restore"}
          onClick={() =>
            void open(
              rows.map((row) => row.stub.id),
              true,
              "restore",
            )
          }
        >
          {t("Restore chat layout")}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          motion="none"

          disabled={pending || !completedIds.length}
          loading={pendingAction === "clear-completed"}
          onClick={() => void remove(completedIds, "clear-completed")}
        >
          {t("Clear completed")}
        </Button>
        <Button
          variant="secondary"
          tone="danger"
          size="sm"
          motion="none"
          disabled={pending || !rows.length}
          loading={pendingAction === "clear-all"}
          onClick={() =>
            void remove(
              rows.map((row) => row.stub.id),
              "clear-all",
            )
          }
        >
          {t("Clear list")}
        </Button>
      </div>
    </div>
  );
  return renderContainer ? (
    <>{renderContainer(content, pending)}</>
  ) : (
    <Modal
      title={t("Recovered sessions")}
      onClose={pending ? () => {} : onClose}
      size="md"
      className="session-recovery-dialog"
      fitViewport
    >
      {content}
    </Modal>
  );
}
