import { t, useLocale } from "../../../shared/i18n";
import { Alert } from "../../../shared/ui/Alert";
import { ConfirmDialog } from "../../../shared/ui/ConfirmDialog";
import type { CrewDefinition } from "../model/crew";
import type { useProjectCrews } from "../model/crewClient";
import { saveCrewAppearance } from "../model/crewAppearance";

export { CrewEditDialog } from "./CrewEditor";

export { CrewTaskDialog as StartCrewDialog } from "./CrewTaskDialog";

export function CrewDeleteDialog({
  state,
  crew,
  activeWork,
  onClose,
}: {
  state: ReturnType<typeof useProjectCrews>;
  crew: CrewDefinition;
  activeWork: number;
  onClose: () => void;
}) {
  useLocale();
  return (
    <ConfirmDialog
      request={{
        title: t("Delete {p0}?", { p0: crew.name }),
        message: t("The crew definition is removed. Library members are kept."),
        confirmLabel: t("Delete crew"),
        confirmDisabled: activeWork > 0,
        body:
          activeWork > 0 ? (
            <Alert tone="warning">{t("Stop this crew's running work before deleting it.")}</Alert>
          ) : undefined,
        onConfirm: async () => {
          await state.call("crews.delete", {
            definitionId: crew.id,
            expectedUpdatedAt: crew.updatedAt,
          });
          saveCrewAppearance(crew.id, { icon: undefined, color: undefined });
        },
      }}
      onSettle={onClose}
    />
  );
}
