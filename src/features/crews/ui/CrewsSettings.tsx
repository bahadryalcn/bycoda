import { useState } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { Alert } from "../../../shared/ui/Alert";
import { Plus } from "../../../shared/ui/icons";
import { Group, Row, Toggle } from "../../settings/ui/settingsControls";
import { useProjectCrews } from "../model/crewClient";
import { saveCrewsOnRail, useCrewsOnRail } from "../model/crewAppearance";
import { CrewAvatar } from "./CrewAvatar";
import { lazySurface } from "../../../shared/ui/lazySurface";
import { CrewLibrary } from "./CrewLibrary";
import { CrewManagementDialog } from "./CrewSessions";
import type { BackgroundSessionTarget } from "../../tasks/model/backgroundSession";

const CrewEditDialog = lazySurface(async () => ({
  default: (await import("./CrewDialogs")).CrewEditDialog,
}));

/** Settings → Crews: where crews show, each crew one click away, and the member library. */
export function CrewsSettings({
  cwd,
  onOpen,
}: {
  cwd: string;
  onOpen?: (target: BackgroundSessionTarget) => void | Promise<void>;
}) {
  useLocale();
  const shown = useCrewsOnRail();
  const state = useProjectCrews(cwd);
  const data = state.data;
  const [dialog, setDialog] = useState<{
    crewId?: string;
    createScope?: "project" | "global";
  } | null>(null);
  const [managedCrewId, setManagedCrewId] = useState<string | null>(null);
  return (
    <>
      <Group title={t("Crews")}>
        <Row label={t("Show crews")}>
          <Toggle label={t("Show crews")} on={shown} onChange={saveCrewsOnRail} />
        </Row>
      </Group>
      <Group
        title={t("Your crews")}
        action={
          <Button
            variant="ghost"
            startIcon={<Plus className="icon-sm" />}
            disabled={!data}
            onClick={() => setDialog({ createScope: "project" })}
          >
            {t("New crew")}
          </Button>
        }
      >
        {!data ? (
          <div className="p-3">
            <Alert tone={state.error ? "warning" : "info"}>
              {state.error ? state.error.message : t("Loading crews…")}
              {state.error ? (
                <Button variant="ghost" onClick={() => void state.refetch()}>
                  {t("Retry")}
                </Button>
              ) : null}
            </Alert>
          </div>
        ) : data.definitions.length === 0 ? (
          <Row label={t("No crews yet")} />
        ) : (
          data.definitions.map((crew) => (
            <Row
              key={crew.id}
              label={
                <span className="flex min-w-0 items-center gap-2">
                  <CrewAvatar crew={crew} className="icon-md" />
                  <span className="truncate">{crew.name}</span>
                </span>
              }
              description={`${crew.projectId ? t("This project") : t("All projects on this host")} · ${t("{p0} members", { p0: crew.agents.length })}`}
            >
              <div className="flex flex-wrap items-center gap-1">
                <Button variant="secondary" onClick={() => setManagedCrewId(crew.id)}>
                  {t("Crew work")}
                </Button>
                <Button variant="ghost" onClick={() => setDialog({ crewId: crew.id })}>
                  {t("Edit")}
                </Button>
              </div>
            </Row>
          ))
        )}
      </Group>
      {data ? <CrewLibrary cwd={cwd} state={state} data={data} /> : null}
      {managedCrewId ? (
        <CrewManagementDialog
          cwd={cwd}
          state={state}
          definitionId={managedCrewId}
          onOpen={onOpen}
          onClose={() => setManagedCrewId(null)}
        />
      ) : null}
      {dialog ? (
        <CrewEditDialog
          cwd={cwd}
          crewId={dialog.crewId}
          createScope={dialog.createScope}
          onClose={() => setDialog(null)}
        />
      ) : null}
    </>
  );
}
