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
import { DropdownMenu, type DropdownMenuItem } from "../../shared/ui/DropdownMenu";
import { EmptyState } from "../../shared/ui/EmptyState";
import { InfoPopover } from "../../shared/ui/InfoPopover";
import { InlineError } from "../../shared/ui/InlineError";
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
  recoveryEntryStatus,
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
import { MoreHorizontal, Search, X } from "../../shared/ui/icons";
import "./session-recovery.css";

const stubPath = (stub: WorkspaceSessionStub) => stub.cwd;
/** A short list is scanned by eye; search appears only when it stops fitting. */
const SEARCH_MIN_ROWS = 8;

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
  const [errorArea, setErrorArea] = useState<"open" | "list">("open");
  const [menuOpen, setMenuOpen] = useState(false);
  const menuAnchor = useRef<HTMLButtonElement>(null);
  const [filterChoice, setFilterChoice] = useState<"attention" | "all">("attention");
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
        const status: RecoveryStatus = recoveryEntryStatus({
          remote,
          host,
          local,
          storedMissing: saved === null,
        });
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
  // The filter only exists while it separates something: with nothing (or everything)
  // needing attention both views are the same list.
  const canFilter = attentionCount > 0 && attentionCount < rows.length;
  const filter = canFilter ? filterChoice : "all";
  const showSearch = rows.length > SEARCH_MIN_ROWS || query !== "";
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
    setErrorArea("open");
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
    setErrorArea("list");
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
  const hiddenCount = rows.length - shown.length;
  const listMaintenancePending =
    pendingAction === "remove-selected" ||
    pendingAction === "clear-completed" ||
    pendingAction === "clear-all";
  // Only offer what applies now; the per-row remove button covers a short list.
  const menuItems: DropdownMenuItem[] = [
    ...(selectedIds.length > 0
      ? ([
          {
            kind: "item",
            id: "remove-selected",
            label: t("Remove {p0} selected from list", { p0: selectedIds.length }),
            description:
              hiddenSelectedCount > 0
                ? t("Conversation history is kept. {p0} selected outside this view stay listed.", {
                    p0: hiddenSelectedCount,
                  })
                : t("Conversation history is kept."),
          },
        ] satisfies DropdownMenuItem[])
      : []),
    ...(completedIds.length > 0
      ? ([
          {
            kind: "item",
            id: "clear-completed",
            label: t("Remove {p0} completed from list", { p0: completedIds.length }),
            description: t("Done and idle entries only. Conversation history is kept."),
          },
        ] satisfies DropdownMenuItem[])
      : []),
    ...(selectedIds.length > 0 || completedIds.length > 0 ? [{ kind: "sep" } as const] : []),
    {
      kind: "item",
      id: "clear-all",
      label: t("Clear recovery list ({p0})", { p0: rows.length }),
      description: t(
        "Removes every entry, including those not shown. Conversation history is kept.",
      ),
      danger: true,
      disabled: rows.length === 0,
    },
  ];
  const pickMaintenance = (id: string) => {
    if (id === "remove-selected") void remove(selectedIds, "remove-selected");
    else if (id === "clear-completed") void remove(completedIds, "clear-completed");
    else if (id === "clear-all")
      void remove(
        rows.map((row) => row.stub.id),
        "clear-all",
      );
  };
  // One entry is cleared by its own remove button; list-wide maintenance needs a list.
  const showMaintenance = rows.length > 1 || listMaintenancePending;
  // The menu sits with the filter and search; a short list has neither, so it joins the
  // footer actions instead of costing a toolbar row of its own.
  const showToolbar = canFilter || showSearch;
  const maintenanceControl = showMaintenance ? (
    <>
      <Button
        ref={menuAnchor}
        variant="ghost"
        size={showToolbar ? undefined : "sm"}
        iconOnly
        label={t("Recovery list maintenance")}
        tooltip={t("Recovery list maintenance")}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        className={showToolbar ? "ms-auto" : undefined}
        disabled={pending && !listMaintenancePending}
        loading={listMaintenancePending}
        onClick={() => setMenuOpen((value) => !value)}
      >
        <MoreHorizontal className="icon-sm" strokeWidth={1.75} />
      </Button>
      {menuOpen ? (
        <DropdownMenu
          anchor={menuAnchor}
          label={t("Recovery list maintenance")}
          returnFocusRef={menuAnchor}
          width={280}
          items={menuItems}
          onPick={pickMaintenance}
          onClose={() => setMenuOpen(false)}
        />
      ) : null}
    </>
  ) : null;
  const primaryOpensSelected = selectedIds.length > 0;
  const listError = error && errorArea === "list" ? error : "";
  const openError = error && errorArea === "open" ? error : "";
  const content = (
    <div className="session-recovery recovery-pane" aria-busy={pending}>
      {showToolbar ? (
        <div className="recovery-toolbar">
          {canFilter ? (
            <SegmentedControl
              label={t("Session filters")}
              value={filter}
              onValueChange={(value) => setFilterChoice(value as "attention" | "all")}
              options={[
                { value: "attention", label: t("Needs attention"), accessory: attentionCount },
                { value: "all", label: t("All sessions"), accessory: rows.length },
              ]}
            />
          ) : null}
          {showSearch ? (
            <SearchInputGroup appearance="field" className="recovery-toolbar-search">
              <Search className="icon-sm shrink-0" aria-hidden="true" />
              <SearchInput
                focusOwner="group"
                aria-label={t("Search recovered sessions")}
                placeholder={t("Search recovered sessions")}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </SearchInputGroup>
          ) : null}
          {maintenanceControl}
        </div>
      ) : null}
      {selected.size > 0 ? (
        <div role="status" className="recovery-status text-ui-caption text-(--ui-text-secondary)">
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
        </div>
      ) : null}
      {listError ? (
        <Alert tone="danger" role="alert">
          {listError}
        </Alert>
      ) : null}
      <div className="recovery-body">
        {shown.length ? (
          <ul className="recovery-list divide-y divide-stroke" aria-label={t("Recovered sessions")}>
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
                    <div className="break-words text-ui-secondary font-medium">{title}</div>
                    <details className="break-words text-ui-caption text-(--ui-text-secondary)">
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
                            : status === "interrupted" ||
                                status === "input" ||
                                status === "retrying"
                              ? "font-medium text-warning"
                              : status === "working"
                                ? "font-medium text-(--ui-tone-info-fg)"
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
                        : t("Recovered {p0}", {
                            p0: formatRelative(recovery.capturedAt, Date.now()),
                          })}
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
                      <InlineError>{t("Could not open this session.")}</InlineError>
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
                    tooltip={t("Remove from recovery list. Conversation history is kept.")}
                    onClick={() => void remove([stub.id], `remove:${stub.id}`)}
                  >
                    <X className="icon-md" aria-hidden="true" />
                  </InlineAction>
                </ActionHost>
              </li>
            ))}
          </ul>
        ) : rows.length === 0 ? (
          <EmptyState
            context="panel"
            kind="empty"
            title={t("No recovered sessions")}
            description={t("Nothing is waiting to be reopened.")}
          />
        ) : query ? (
          <EmptyState
            context="panel"
            kind="filtered"
            title={t("No matching sessions")}
            description={t("No recovered session matches “{p0}”.", { p0: query.trim() })}
            action={
              <>
                <Button variant="secondary" size="sm" onClick={() => setQuery("")}>
                  {t("Clear search")}
                </Button>
                {filter === "attention" && attentionCount < rows.length ? (
                  <Button variant="ghost" size="sm" onClick={() => setFilterChoice("all")}>
                    {t("Search all sessions")}
                  </Button>
                ) : null}
              </>
            }
          />
        ) : (
          <EmptyState
            context="panel"
            kind="empty"
            title={t("No recovered sessions")}
            description={t("Nothing is waiting to be reopened.")}
          />
        )}
      </div>
      <div className="recovery-footer border-t border-stroke">
        {openError ? (
          <Alert tone="danger" role="alert">
            {openError}
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
        <div className="recovery-actions">
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
          <InfoPopover className="shrink-0">
            <p>
              {hiddenCount > 0
                ? t("Open all opens all {p0} recovered sessions, including {p1} not shown here.", {
                    p0: rows.length,
                    p1: hiddenCount,
                  })
                : t("Open all opens all {p0} recovered sessions.", { p0: rows.length })}
            </p>
            <p>
              {t(
                "Opening tabs does not restart work. Restore chat layout also brings back your earlier chat splits.",
              )}
            </p>
          </InfoPopover>
          {showToolbar ? null : maintenanceControl}
          <span className="recovery-actions-end flex flex-wrap items-center gap-2">
            {primaryOpensSelected ? (
              <Button
                variant="primary"
                size="sm"
                motion="none"
                disabled={pending}
                loading={pendingAction === "open-selected"}
                onClick={() => void open(selectedIds)}
              >
                {t("Open selected")} ({selectedIds.length})
              </Button>
            ) : null}
            <Button
              variant={primaryOpensSelected ? "secondary" : "primary"}
              size="sm"
              motion="none"
              disabled={pending || !rows.length}
              loading={pendingAction === "open-all"}
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
          </span>
        </div>
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
