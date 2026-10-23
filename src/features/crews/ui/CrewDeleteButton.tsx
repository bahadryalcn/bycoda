import { useState } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { Alert } from "../../../shared/ui/Alert";
import { ConfirmMorph } from "../../../shared/ui/ConfirmMorph";
import { Trash2 } from "../../../shared/ui/icons";
import type { CrewDefinition } from "../model/crew";
import type { useProjectCrews } from "../model/crewClient";
import { saveCrewAppearance } from "../model/crewAppearance";

/** Deletes a saved crew after confirmation; hosts without delete show nothing. */
export function CrewDeleteButton({
  state,
  crew,
  onDeleted,
}: {
  state: ReturnType<typeof useProjectCrews>;
  crew: CrewDefinition;
  onDeleted?: () => void;
}) {
  useLocale();
  const [error, setError] = useState("");
  if (!state.data?.deleteSupported || !crew.updatedAt) return null;
  return (
    <div className="flex flex-col gap-2">
      <ConfirmMorph
        label={t("Delete crew")}
        icon={<Trash2 aria-hidden className="icon-sm" />}
        tone="danger"
        confirmMode="press"
        onConfirm={async () => {
          setError("");
          try {
            await state.call("crews.delete", {
              definitionId: crew.id,
              expectedUpdatedAt: crew.updatedAt,
            });
            // The refetched list drops this crew and may unmount this button
            // before the morph reports done, so clean up here.
            saveCrewAppearance(crew.id, { icon: undefined, color: undefined });
            onDeleted?.();
          } catch (reason) {
            setError(reason instanceof Error ? reason.message : String(reason));
            throw reason;
          }
        }}
      />
      {error ? (
        <Alert tone="danger" role="alert">
          {error}
        </Alert>
      ) : null}
    </div>
  );
}
