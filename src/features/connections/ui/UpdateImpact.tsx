import { useEffect, useState, useSyncExternalStore } from "react";
import { formatNumber, useT } from "../../../shared/i18n";
import { DataTable, DataTableRow } from "../../../shared/ui/SortableDataTable";
import { Text } from "../../../shared/ui/Text";
import { Alert } from "../../../shared/ui/Alert";
import { InlineError } from "../../../shared/ui/InlineError";
import { LoadingText } from "../../../shared/ui/LoadingText";
import { getSessions, subscribeSessionCommits } from "../../sessions/public/sessionsStore";
import { remoteBackoffDelay } from "../model/remotePollingPolicy";
import {
  readUpdateImpact,
  type UpdateMachineImpact,
  type UpdateTarget,
} from "../model/updateImpact";

function subscribeDesktopActivity(listener: () => void) {
  return subscribeSessionCommits(listener);
}

const noDesktopWork: readonly string[] = [];
let desktopWork = noDesktopWork;
function readDesktopActivity(): readonly string[] {
  const ids = getSessions()
    .filter((session) => session.busy && !session.continuingElsewhere && !session.worktreeRemoved)
    .map((session) => session.id);
  if (ids.length !== desktopWork.length || ids.some((id, index) => id !== desktopWork[index]))
    desktopWork = ids;
  return desktopWork;
}

type ImpactView = {
  rows?: UpdateMachineImpact[];
  /** No usable reading at all: the gating below treats the activity as unknown. */
  failed: boolean;
  /** The last reading in `rows` is kept, but the newest refresh did not succeed. */
  stale: boolean;
};

/** Shared update preview. Only the explicitly named target is changed. */
export function UpdateImpact({ target }: { target: UpdateTarget }) {
  const [view, setView] = useState<ImpactView>({ failed: false, stale: false });
  const machineId = typeof target === "object" ? target.machineId : target;
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Poll Host activity while confirmation is mounted; stop its timer, skip timed reads while hidden and ignore late snapshots on close.
  useEffect(() => {
    let closed = false;
    let running = false;
    let failures = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setView({ failed: false, stale: false });
    const refresh = async () => {
      if (closed || running) return;
      running = true;
      try {
        const next = await readUpdateImpact(
          machineId === "app" || machineId === "local-host" ? machineId : { machineId },
          (row) => {
            if (closed) return;
            setView((current) => ({
              ...current,
              rows: [...(current.rows?.filter((item) => item.id !== row.id) ?? []), row],
              failed: false,
            }));
          },
        );
        failures = 0;
        if (!closed)
          setView({ rows: next, failed: !next.some((row) => row.affected), stale: false });
      } catch {
        failures += 1;
        // Keep the last reading (and its warning) when there is one; only a first failure is unknown.
        if (!closed)
          setView((current) =>
            current.rows ? { ...current, stale: true } : { failed: true, stale: false },
          );
      } finally {
        running = false;
        // Ten seconds while healthy; repeated failures back off, never faster than that.
        if (!closed)
          timer = setTimeout(
            () => {
              if (!document.hidden) void refresh();
            },
            Math.max(10_000, remoteBackoffDelay(failures)),
          );
      }
    };
    const onVisible = () => {
      if (document.hidden || closed) return;
      clearTimeout(timer);
      void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    void refresh();
    return () => {
      closed = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [machineId]);
  return target === "app" ? (
    <AppUpdateImpact rows={view.rows} stale={view.stale} />
  ) : (
    <UpdateImpactDetails rows={view.rows} failed={view.failed} stale={view.stale} target={target} />
  );
}

function AppUpdateImpact({ rows, stale }: { rows?: UpdateMachineImpact[]; stale: boolean }) {
  const desktopSessions = useSyncExternalStore(subscribeDesktopActivity, readDesktopActivity);
  return (
    <UpdateImpactDetails rows={rows} stale={stale} target="app" desktopSessions={desktopSessions} />
  );
}

export function UpdateImpactDetails({
  rows,
  failed = false,
  stale = false,
  target,
  desktopSessions = noDesktopWork,
}: {
  rows?: UpdateMachineImpact[];
  failed?: boolean;
  /** Rows are from an earlier successful read; say so beside them. */
  stale?: boolean;
  target: UpdateTarget;
  desktopSessions?: readonly string[];
}) {
  const t = useT();
  const app = target === "app";
  const local = rows?.find((row) => row.local);
  const affected = rows?.find((row) => row.affected);
  const desktopRunning = local?.desktopSessionIds
    ? new Set([...desktopSessions, ...local.desktopSessionIds]).size
    : Math.max(desktopSessions.length, local?.desktopRunning ?? 0);
  const interrupted = app ? desktopRunning : (affected?.running ?? 0);
  const unknown = !app && (failed || affected?.running === null);
  const visible = (rows ?? []).filter((row) => (!app || !row.local) && (row.running ?? 0) > 0);
  const localRunning = Math.max(0, (local?.running ?? 0) - (local?.desktopRunning ?? 0));
  if (app && localRunning + desktopRunning > 0)
    visible.unshift({
      id: local?.id ?? "this-computer",
      name: "",
      local: true,
      affected: true,
      running: localRunning + desktopRunning,
      desktopRunning,
    });
  const checking = !app && !affected && !failed;
  if (!visible.length && !interrupted && !unknown && !checking && !stale) return null;
  return (
    <div className="flex flex-col gap-3">
      {stale ? (
        <InlineError>
          {t("Could not refresh machine activity. Showing the last known activity.")}
        </InlineError>
      ) : null}
      {visible.length ? (
        <DataTable
          caption={t("Update impact by machine")}
          headers={[
            { label: t("Machine") },
            { label: t("Update") },
            { label: t("Running sessions") },
          ]}
        >
          {visible.map((row) => (
            <DataTableRow
              key={row.id}
              cells={[
                <Text key="name" wrap="anywhere">
                  {row.local ? t("This computer") : row.name}
                </Text>,
                <Text key="effect" size="secondary" wrap="anywhere">
                  {row.affected
                    ? app
                      ? t("This app restarts")
                      : t("Host restarts")
                    : t("No update on this machine")}
                </Text>,
                <Text key="running" tone={row.affected ? "warning" : "secondary"}>
                  {formatNumber(row.running ?? 0)}
                </Text>,
              ]}
            />
          ))}
        </DataTable>
      ) : null}
      {checking ? <LoadingText delay={false}>{t("Checking machine activity…")}</LoadingText> : null}
      {interrupted > 0 || unknown ? (
        <Alert
          tone="warning"
          title={
            unknown
              ? t("Machine activity could not be checked.")
              : t("Sessions that may be interrupted: {p0}.", { p0: formatNumber(interrupted) })
          }
        >
          {unknown
            ? t("Unverified activity may also be interrupted.")
            : t("Session history is kept. Interrupted work may require resuming.")}
        </Alert>
      ) : null}
    </div>
  );
}
