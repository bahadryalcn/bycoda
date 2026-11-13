import { Text } from "../../../shared/ui/Text";
import { useQuery } from "@tanstack/react-query";
import { useId, useState } from "react";
import { t } from "../../../shared/i18n";
import { pathKey } from "../../../shared/lib/paths";
import { Button } from "../../../shared/ui/Button";
import { InlineMessage } from "../../../shared/ui/InlineError";
import { InlineError } from "../../../shared/ui/InlineError";
import { Modal, ModalActions } from "../../../shared/ui/Modal";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { TextField } from "../../../shared/ui/TextField";
import { Folder, FolderPlus } from "../../../shared/ui/icons";
import {
  backgroundMachineFor,
  backgroundMachines,
  hostProjectCwd,
  invalidateMachineSnapshot,
  machineProjects,
} from "../../automations/public/hostMachines";
import { remoteRequest } from "../../connections/public/connections";
import { projectDisplayName } from "../../projects/public/projectNames";
import { rememberProject } from "../../projects/public/recents";
import { HOST_CREWS } from "../model/crew";
import {
  createCrewProject,
  crewProjectNameIssue,
  newCrewProjectParent,
} from "../model/crewProjects";
import { crewMachineLabel } from "../model/crewActionError";
import { useProjectCrews } from "../model/crewClient";
import { crewCwdOn, orderCrewMachines } from "../model/crewMachineScope";

type CrewState = ReturnType<typeof useProjectCrews>;

/** Which machine and project the dialog shows work for and starts new work in. It opens
 * on the opened project's own machine (this computer for a local project); other
 * connected machines, any project registered there, or a new project folder are the
 * alternatives. */
export function useCrewMachineScope(cwd: string, state: CrewState) {
  const createFormId = useId();
  const machineList = useQuery({
    queryKey: [HOST_CREWS, "machines"],
    queryFn: async () => orderCrewMachines(await backgroundMachines(HOST_CREWS)),
    staleTime: 30_000,
    retry: false,
  });
  const machines = machineList.data;
  const [scopeCwd, setScopeCwd] = useState(cwd);
  const away = scopeCwd !== cwd;
  const scoped = useProjectCrews(scopeCwd, away);
  const [switching, setSwitching] = useState(false);
  const [switchError, setSwitchError] = useState("");
  const homeId = machines ? backgroundMachineFor(machines, cwd)?.id : undefined;
  const currentId = machines ? backgroundMachineFor(machines, scopeCwd)?.id : undefined;
  const choose = async (id: string) => {
    const machine = machines?.find((entry) => entry.id === id);
    if (!machine || id === currentId) return;
    setSwitching(true);
    setSwitchError("");
    try {
      const projects = id === homeId ? [] : await machineProjects(machine);
      const next = crewCwdOn(machine, projects, cwd, homeId);
      if (next) setScopeCwd(next);
      else
        setSwitchError(
          t("{p0} has no projects yet. Open a project there first.", {
            p0: machine.name,
          }),
        );
    } catch (reason) {
      setSwitchError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSwitching(false);
    }
  };
  const machine = machines?.find((entry) => entry.id === currentId);
  const projects = useQuery({
    queryKey: [HOST_CREWS, "projects", currentId],
    queryFn: () => machineProjects(machine!),
    enabled: !!machine,
    staleTime: 30_000,
    retry: false,
  });
  const [newName, setNewName] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");
  const parent = newCrewProjectParent(scopeCwd);
  const create = async () => {
    if (!machine || creating || newName === null) return;
    const issue = crewProjectNameIssue(newName);
    if (issue) return setCreateError(issue);
    setCreating(true);
    setCreateError("");
    try {
      const project = await createCrewProject(
        (id, method, params) => remoteRequest(id, method, params, false, true),
        machine.id,
        parent,
        newName,
      );
      invalidateMachineSnapshot(machine.id);
      await projects.refetch();
      const next = hostProjectCwd(machine, project);
      // The new project joins the project list like one opened by hand.
      await rememberProject(next).catch(() => {});
      setScopeCwd(next);
      setNewName(null);
    } catch (reason) {
      setCreateError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setCreating(false);
    }
  };
  /** `wide`: a full-width form field; otherwise a compact header control. Both keep the label. */
  const projectPicker = (disabled: boolean, wide = false) => {
    if (!machine) return null;
    const listed = (projects.data ?? []).map((project) => hostProjectCwd(machine, project));
    const options = [
      ...(listed.some((entry) => pathKey(entry) === pathKey(scopeCwd)) ? [] : [scopeCwd]),
      ...listed,
    ].map((entry) => ({
      value: entry,
      label: projectDisplayName(entry),
      description: entry,
      // Shown in the trigger too, so the header control reads as a project without a label.
      icon: <Folder className="icon-sm" />,
    }));
    const cancel = () => {
      setNewName(null);
      setCreateError("");
    };
    return (
      <div
        className={`flex min-w-0 flex-col gap-1 ${wide ? "flex-1 basis-48" : "w-full max-w-64 @min-[36rem]/crew-management:w-64"}`}
      >
        <SearchableSelect
          label={t("Project")}
          value={scopeCwd}
          options={options}
          disabled={disabled || creating}
          onChange={setScopeCwd}
          // Pinned below the list, so it stays visible however many projects there are.
          footer={({ close }) => (
            <Button
              variant="ghost"
              size="sm"
              startIcon={<FolderPlus className="icon-sm" />}
              onClick={() => {
                close();
                setCreateError("");
                setNewName("");
              }}
            >
              {t("New project…")}
            </Button>
          )}
        />
        {newName !== null ? (
          <Modal
            title={t("Create project")}
            context={crewMachineLabel(machine)}
            size="sm"
            initialFocus="input"
            onClose={() => {
              if (!creating) cancel();
            }}
            footer={
              <ModalActions>
                <Button variant="ghost" disabled={creating} onClick={cancel}>
                  {t("Cancel")}
                </Button>
                <Button
                  type="submit"
                  form={createFormId}
                  variant="primary"
                  startIcon={<FolderPlus className="icon-sm" />}
                  loading={creating}
                  disabled={disabled || !newName.trim()}
                >
                  {t("Create project")}
                </Button>
              </ModalActions>
            }
          >
            <form
              id={createFormId}
              className="flex min-w-0 flex-col gap-3"
              onSubmit={(event) => {
                event.preventDefault();
                create().catch(() => {});
              }}
            >
              <TextField
                label={t("Project name")}
                placeholder={t("New project folder")}
                value={newName}
                autoFocus
                disabled={creating}
                error={createError || undefined}
                onChange={(event) => setNewName(event.target.value)}
              />
              <Text as="p" className="min-w-0 break-words">
                {t("Created in {p0}", { p0: parent })}
              </Text>
            </form>
          </Modal>
        ) : null}
        {projects.error ? (
          <InlineMessage tone="warning">
            {projects.error instanceof Error ? projects.error.message : String(projects.error)}
          </InlineMessage>
        ) : null}
      </div>
    );
  };
  const picker = (disabled: boolean) =>
    machineList.error || (machines && machines.length > 1) ? (
      <div className="flex min-w-0 flex-1 basis-48 flex-col gap-1">
        {machines && machines.length > 1 ? (
          <SearchableSelect
            label={t("Machine")}
            value={currentId ?? ""}
            options={machines.map((machine) => ({
              value: machine.id,
              label: crewMachineLabel(machine),
              description:
                machine.id === currentId && away ? projectDisplayName(scopeCwd) : undefined,
            }))}
            disabled={disabled || switching}
            onChange={(id) =>
              void choose(id).catch((reason: unknown) => setSwitchError(String(reason)))
            }
          />
        ) : null}
        {machineList.error ? (
          <InlineError
            retry={{ onRetry: () => void machineList.refetch(), pending: machineList.isFetching }}
          >
            {machineList.error instanceof Error
              ? machineList.error.message
              : String(machineList.error)}
          </InlineError>
        ) : null}
        {switchError ? <InlineMessage tone="warning">{switchError}</InlineMessage> : null}
      </div>
    ) : null;
  return { cwd: scopeCwd, state: away ? scoped : state, picker, projectPicker };
}
