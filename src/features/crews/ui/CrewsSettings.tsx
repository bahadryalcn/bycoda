import { useState } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { Alert } from "../../../shared/ui/Alert";
import { Plus } from "../../../shared/ui/icons";
import { Group, Row, Toggle } from "../../settings/ui/settingsControls";
import { useProjectCrews } from "../model/crewClient";
import { saveCrewsOnRail, useCrewsOnRail } from "../model/crewAppearance";
import { CrewAvatar } from "./CrewAvatar";
import { CrewEditDialog } from "./CrewDialogs";

/** Settings → Crews: where crews show, and each crew's settings one click away. */
export function CrewsSettings({ cwd }: { cwd: string }) {
  useLocale();
  const shown = useCrewsOnRail();
  const state = useProjectCrews(cwd);
  const data = state.data;
  const [dialog, setDialog] = useState<{
    crewId?: string;
    createScope?: "project" | "global";
  } | null>(null);
  return (
    <>
      <Group title={t("Crews")}>
        <Row
          label={t("Show crews")}
          description={t(
            "Teams of agents on the project rail: a coordinator plans the work, specialists deliver it and a reviewer checks it. Turn this off to hide them.",
          )}
        >
          <Toggle label={t("Show crews")} on={shown} onChange={saveCrewsOnRail} />
        </Row>
      </Group>
      <Group
        title={t("Your crews")}
        description={t(
          "Project crews work only in this project; global crews are available in every project on this host. Add one with the plus on the rail or here.",
        )}
        action={
          <Button
            variant="ghost"
            startIcon={<Plus className="size-3.5" />}
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
                  <CrewAvatar crew={crew} className="size-4" />
                  <span className="truncate">{crew.name}</span>
                </span>
              }
              description={`${crew.projectId ? t("This project") : t("All projects on this host")} · ${t("{p0} members", { p0: crew.agents.length })}`}
            >
              <Button variant="ghost" onClick={() => setDialog({ crewId: crew.id })}>
                {t("Edit")}
              </Button>
            </Row>
          ))
        )}
      </Group>
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
