import type { Dispatch, SetStateAction } from "react";
import { lazySurface } from "../../../shared/ui/lazySurface";
import type { useProjectCrews } from "../model/crewClient";
import type { CrewDialog } from "./crewMenuItems";

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
}: {
  cwd: string;
  state: ReturnType<typeof useProjectCrews>;
  dialog: CrewDialog | null;
  setDialog: Dispatch<SetStateAction<CrewDialog | null>>;
}) {
  const data = state.data;
  const deleting =
    data && dialog?.kind === "delete"
      ? data.definitions.find((definition) => definition.id === dialog.crewId)
      : undefined;
  return (
    <>
      {dialog?.kind === "edit" ? (
        <CrewEditDialog
          cwd={cwd}
          crewId={dialog.crewId}
          createScope={dialog.createScope}
          copyOf={dialog.copyOf}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog?.kind === "start" ? (
        <StartCrewDialog
          cwd={cwd}
          state={state}
          definitionId={dialog.definitionId}
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
