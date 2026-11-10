import type { ComponentProps, Dispatch, SetStateAction } from "react";
import { lazySurface } from "../../../shared/ui/lazySurface";
import type { useProjectCrews } from "../model/crewClient";
import type { CrewDialog } from "./crewMenuItems";
import { CrewManagementDialog } from "./CrewSessions";

/** Opens a crew's coordinator or work session; the host supplies it. */
export type OpenCrewSession = NonNullable<ComponentProps<typeof CrewManagementDialog>["onOpen"]>;

const CrewDeleteDialog = lazySurface(async () => ({
  default: (await import("./CrewDialogs")).CrewDeleteDialog,
}));
const CrewEditDialog = lazySurface(async () => ({
  default: (await import("./CrewDialogs")).CrewEditDialog,
}));
const StartCrewDialog = lazySurface(async () => ({
  default: (await import("./CrewDialogs")).StartCrewDialog,
}));

/** Renders the crew dialog named by `dialog`; the rail and the Crews page share it. */
export function CrewDialogHost({
  cwd,
  state,
  dialog,
  setDialog,
  onOpenSession,
}: {
  cwd: string;
  state: ReturnType<typeof useProjectCrews>;
  dialog: CrewDialog | null;
  setDialog: Dispatch<SetStateAction<CrewDialog | null>>;
  onOpenSession?: OpenCrewSession;
}) {
  const data = state.data;
  const deleting =
    data && dialog?.kind === "delete"
      ? data.definitions.find((definition) => definition.id === dialog.crewId)
      : undefined;
  return (
    <>
      {dialog?.kind === "work" ? (
        <CrewManagementDialog
          cwd={cwd}
          state={state}
          definitionId={dialog.crewId}
          onOpen={onOpenSession}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog?.kind === "edit" ? (
        <CrewEditDialog
          cwd={cwd}
          crewId={dialog.crewId}
          createScope={dialog.createScope}
          copyOf={dialog.copyOf}
          initialPage={dialog.initialPage}
          onStart={(definitionId) => setDialog({ kind: "start", definitionId })}
          onClose={() =>
            setDialog(
              dialog.returnToStart ? { kind: "start", definitionId: dialog.returnToStart } : null,
            )
          }
        />
      ) : null}
      {dialog?.kind === "start" ? (
        <StartCrewDialog
          cwd={cwd}
          state={state}
          definitionId={dialog.definitionId}
          onOpen={onOpenSession}
          onEdit={(crewId) => setDialog({ kind: "edit", crewId, returnToStart: crewId })}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {deleting && data ? (
        <CrewDeleteDialog
          state={state}
          crew={deleting}
          activeWork={
            data.runs.filter((run) => run.definition.id === deleting.id && run.status === "active")
              .length
          }
          onClose={() => setDialog(null)}
        />
      ) : null}
    </>
  );
}
