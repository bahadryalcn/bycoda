import { useEffect, useState } from "react";
import { formatNumber, useT } from "../../../shared/i18n";
import { DataTable, DataTableRow } from "../../../shared/ui/SortableDataTable";
import { Text } from "../../../shared/ui/Text";
import { Alert } from "../../../shared/ui/Alert";
import {
  readUpdateImpact,
  type UpdateMachineImpact,
  type UpdateTarget,
} from "../model/updateImpact";

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
        );
        if (!closed) {
          setRows(next);
          setFailed(false);
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
  return <UpdateImpactDetails rows={rows} failed={failed} target={target} />;
}

export function UpdateImpactDetails({
  rows,
  failed = false,
  target,
}: {
  rows?: UpdateMachineImpact[];
  failed?: boolean;
  target: UpdateTarget;
}) {
  const t = useT();
  const app = target === "app";
  const interrupted =
    rows?.reduce(
      (count, row) =>
        count + (app ? (row.desktopRunning ?? 0) : row.affected ? (row.running ?? 0) : 0),
      0,
    ) ?? 0;
  const unknown = failed || rows?.some((row) => (app || row.affected) && row.running === null);
  return (
    <div className="flex flex-col gap-3">
      {rows ? (
        <DataTable
          caption={t("Update impact by machine")}
          headers={[
            { label: t("Machine") },
            { label: t("Update") },
            { label: t("Running sessions") },
          ]}
        >
          {rows.map((row) => (
            <DataTableRow
              key={row.id}
              cells={[
                <Text key="name" wrap="anywhere">
                  {row.name || t("This computer")}
                  {row.local && row.name ? ` · ${t("This computer")}` : ""}
                </Text>,
                <Text key="effect" size="secondary" wrap="anywhere">
                  {row.affected
                    ? app
                      ? t("This app restarts")
                      : t("Host restarts")
                    : t("No update on this machine")}
                </Text>,
                <Text
                  key="running"
                  tone={row.running === null || row.running > 0 ? "warning" : "secondary"}
                >
                  {row.running === null ? t("Unknown") : formatNumber(row.running)}
                  {app && (row.desktopRunning ?? 0) > 0
                    ? ` · ${t("{p0} may stop", { p0: formatNumber(row.desktopRunning!) })}`
                    : ""}
                </Text>,
              ]}
            />
          ))}
        </DataTable>
      ) : (
        <Text tone={failed ? "warning" : "secondary"}>
          {failed ? t("Machine activity could not be checked.") : t("Checking machine activity…")}
        </Text>
      )}
      <Alert tone="warning">
        <div className="flex flex-col gap-1">
          {interrupted > 0 ? (
            <Text>
              {t("Sessions that may be interrupted: {p0}.", { p0: formatNumber(interrupted) })}
            </Text>
          ) : null}
          {!rows || unknown ? (
            <Text>{t("Unverified activity may also be interrupted.")}</Text>
          ) : null}
          <Text>
            {app
              ? t(
                  "Desktop-owned work may stop when this app restarts. Host-owned work continues while its Host stays running.",
                )
              : t("Running sessions and shells on the updated Host are interrupted.")}
          </Text>
          <Text>{t("Session history is kept. Interrupted work may require resuming.")}</Text>
        </div>
      </Alert>
    </div>
  );
}
