import { LoadingText } from "../../../shared/ui/LoadingText";
import { useRef, useState } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { Alert } from "../../../shared/ui/Alert";
import { DropdownMenu } from "../../../shared/ui/DropdownMenu";
import { MoreHorizontal, Plus } from "../../../shared/ui/icons";
import { Group, Row, Toggle } from "../../settings/ui/settingsControls";
import "../../settings/ui/SettingsCollection.css";
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
  const noProject = !cwd || cwd === "~";
  const [dialog, setDialog] = useState<{
    crewId?: string;
    createScope?: "project" | "global";
  } | null>(null);
  const [managedCrewId, setManagedCrewId] = useState<string | null>(null);
  return (
    <>
      <Group title={t("Sidebar")}>
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
            {state.error ? (
              <Alert
                tone="warning"
                action={
                  <Button
                    variant="secondary"
                    loading={state.isFetching}
                    onClick={() => void state.refetch()}
                  >
                    {t("Retry")}
                  </Button>
                }
              >
                {state.error.message}
              </Alert>
            ) : noProject ? (
              // The query is disabled without a real project folder: say so instead of loading forever.
              <Alert tone="info">{t("Open a project to manage its crews.")}</Alert>
            ) : (
              <LoadingText>{t("Loading crews…")}</LoadingText>
            )}
          </div>
        ) : (
          <>
            {state.error ? (
              // A failed refresh keeps the last list usable and says so.
              <div className="p-3 pb-0">
                <Alert
                  tone="warning"
                  action={
                    <Button
                      variant="secondary"
                      loading={state.isFetching}
                      onClick={() => void state.refetch()}
                    >
                      {t("Retry")}
                    </Button>
                  }
                >
                  {state.error.message}
                </Alert>
              </div>
            ) : null}
            {data.definitions.length === 0 ? (
              <Row label={t("No crews yet")} />
            ) : (
              <div className="settings-collection">
                <div
                  className="settings-collection-list"
                  role="region"
                  aria-label={t("Your crews")}
                  tabIndex={0}
                >
                  {data.definitions.map((crew) => (
                    <div key={crew.id} className="settings-collection-row">
                      <CrewAvatar crew={crew} className="icon-md shrink-0" />
                      <div className="settings-collection-main">
                        <p className="settings-collection-title">{crew.name}</p>
                        {/* Scope and size are data, not help text: they stay visible in the row. */}
                        <p className="settings-collection-meta">
                          {[
                            crew.projectId ? t("This project") : t("All projects on this host"),
                            t("{p0} members", { p0: crew.agents.length }),
                          ].join(" · ")}
                        </p>
                      </div>
                      <div className="settings-collection-actions">
                        <Button
                          variant="ghost"
                          aria-label={t("Edit {p0}", { p0: crew.name })}
                          onClick={() => setDialog({ crewId: crew.id })}
                        >
                          {t("Edit")}
                        </Button>
                        <CrewRowMenu
                          crewName={crew.name}
                          onManage={() => setManagedCrewId(crew.id)}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
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

/** Overflow actions of one crew row; Edit stays direct beside it. */
function CrewRowMenu({ crewName, onManage }: { crewName: string; onManage: () => void }) {
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        ref={trigger}
        variant="ghost"
        iconOnly
        label={t("Crew actions")}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        <MoreHorizontal className="icon-sm" />
      </Button>
      {open ? (
        <DropdownMenu
          anchor={trigger}
          label={t("Crew actions")}
          items={[
            {
              kind: "item",
              id: "work",
              label: t("Crew work"),
              title: t("Crew work: {p0}", { p0: crewName }),
            },
          ]}
          onPick={() => onManage()}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}
