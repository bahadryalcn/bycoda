import { t } from "../../../../shared/i18n";
import { Toast } from "../../../../shared/ui/ToastRegion";
import { assistantJobVisible } from "../../model/assistantJobs";
import { restoreNotesInOrder } from "./noteBulkDelete";
import { useAssistantRoom } from "./assistantRoomContext";

/** Deletion notices as shared toasts: Undo while a receipt exists, otherwise a link to Recently deleted. */
export function RoomUndoBars() {
  const room = useAssistantRoom();
  const {
    environmentId,
    assistantRequest,
    canSeeProject,
    setTrash,
    pending,
    undo,
    setUndo,
    deletedNoteWithoutReceipt,
    setDeletedNoteWithoutReceipt,
    run,
    errorFor,
  } = room;

  return (
    <>
      {undo &&
        undo.environmentId === environmentId &&
        (!undo.projectId ||
          assistantJobVisible(
            { projectId: undo.projectId, projectIds: undo.projectIds },
            canSeeProject,
          )) && (
          <>
            <Toast
              tone="success"
              title={t("Deleted")}
              message={undo.label}
              durationMs={null}
              onDismiss={() => setUndo(null)}
              action={{
                label: t("Undo"),
                disabled: Boolean(pending),
                onClick: () =>
                  void run("undo", t("Restoring…"), async () => {
                    const { remaining, error } = await restoreNotesInOrder(
                      undo.ids ?? [undo.id],
                      (id) => assistantRequest({ op: "trash.restore", id }, undo.environmentId),
                    );
                    if (remaining.length) {
                      // Keep only what is still deleted so a retry never restores twice.
                      if (undo.ids) setUndo({ ...undo, id: remaining[0]!, ids: remaining });
                      if (error) throw error;
                      throw new Error(
                        t(
                          "The restore could not be confirmed. Check Recently deleted before retrying.",
                        ),
                      );
                    }
                    setUndo(null);
                  }),
              }}
            />
            {errorFor("undo")}
          </>
        )}
      {deletedNoteWithoutReceipt && (
        <Toast
          tone="success"
          title={t("Deleted")}
          message={deletedNoteWithoutReceipt}
          durationMs={null}
          onDismiss={() => setDeletedNoteWithoutReceipt(null)}
          action={{
            label: t("Recently deleted"),
            onClick: () => {
              setDeletedNoteWithoutReceipt(null);
              setTrash(true);
            },
          }}
        />
      )}
    </>
  );
}
