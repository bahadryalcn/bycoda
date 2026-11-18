import { useEffect, useState, useSyncExternalStore } from "react";
import { formatNumber, useT } from "../../../shared/i18n";
import { DataTable, DataTableRow } from "../../../shared/ui/SortableDataTable";
import { Text } from "../../../shared/ui/Text";
import { Alert } from "../../../shared/ui/Alert";
import { LoadingText } from "../../../shared/ui/LoadingText";
import { getSessions, subscribeSessionCommits } from "../../sessions/public/sessionsStore";
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

/** Shared update preview. Only the explicitly named target is changed. */
export function UpdateImpact({ target }: { target: UpdateTarget }) {
  const [rows, setRows] = useState<UpdateMachineImpact[]>();
  const [failed, setFailed] = useState(false);
  const machineId = typeof target === "object" ? target.machineId : target;
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Poll Host activity while confirmation is mounted; stop its timer and ignore late snapshots on close.
  useEffect(() => {
    let closed = false;
    let timer: ReturnType<typeof setTimeout>;
    setRows(undefined);
    setFailed(false);
    const refresh = async () => {
      try {
        const next = await readUpdateImpact(
          machineId === "app" || machineId === "local-host" ? machineId : { machineId },
          (row) => {
            if (closed) return;
            setRows((current) => [...(current?.filter((item) => item.id !== row.id) ?? []), row]);
            setFailed(false);
          },
        );
        if (!closed) {
          setRows(next);
          setFailed(!next.some((row) => row.affected));
        }
      } catch {
        if (!closed) {
          setRows(undefined);
          setFailed(true);
        }
      } finally {
        if (!closed) timer = setTimeout(() => void refresh(), 10_000);
      }
    };
    void refresh();
    return () => {
      closed = true;
      clearTimeout(timer);
    };
  }, [machineId]);
  return target === "app" ? (
    <AppUpdateImpact rows={rows} />
  ) : (
    <UpdateImpactDetails rows={rows} failed={failed} target={target} />
  );
}

function AppUpdateImpact({ rows }: { rows?: UpdateMachineImpact[] }) {
  const desktopSessions = useSyncExternalStore(subscribeDesktopActivity, readDesktopActivity);
  return <UpdateImpactDetails rows={rows} target="app" desktopSessions={desktopSessions} />;
}

export function UpdateImpactDetails({
  rows,
  failed = false,
  target,
  desktopSessions = noDesktopWork,
}: {
  rows?: UpdateMachineImpact[];
  failed?: boolean;
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
  if (!visible.length && !interrupted && !unknown && !checking) return null;
  return (
    <div className="flex flex-col gap-3">
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
