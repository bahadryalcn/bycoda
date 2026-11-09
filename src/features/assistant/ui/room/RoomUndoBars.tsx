import { t } from "../../../../shared/i18n";
import { Button } from "../../../../shared/ui/Button";
import { X } from "../../../../shared/ui/icons";
import { assistantJobVisible } from "../../model/assistantJobs";
import styles from "./RoomShell.module.css";
import { useAssistantRoom } from "./assistantRoomContext";

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
          <div className={styles.undo}>
            <span className={styles.undoText}>
              {t("Deleted")}: {undo.label}
            </span>
            <span className={styles.undoActions}>
              <Button
                disabled={Boolean(pending)}
                onClick={() =>
                  run("undo", t("Restoring..."), async () => {
                    const result = await assistantRequest(
                      { op: "trash.restore", id: undo.id },
                      undo.environmentId,
                    );
                    if (result.ok !== true)
                      throw new Error(
                        t(
                          "The restore could not be confirmed. Check Recently deleted before retrying.",
                        ),
                      );
                    setUndo(null);
                  })
                }
              >
                {t("Undo")}
              </Button>
              <Button iconOnly variant="ghost" label={t("Dismiss")} onClick={() => setUndo(null)}>
                <X className="icon-sm" />
              </Button>
            </span>
            {errorFor("undo")}
          </div>
        )}
      {deletedNoteWithoutReceipt && (
        <div className={styles.undo}>
          <span className={styles.undoText}>
            {t("Deleted")}: {deletedNoteWithoutReceipt}
          </span>
          <span className={styles.undoActions}>
            <Button
              onClick={() => {
                setDeletedNoteWithoutReceipt(null);
                setTrash(true);
              }}
            >
              {t("Recently deleted")}
            </Button>
            <Button
              iconOnly
              variant="ghost"
              label={t("Dismiss")}
              onClick={() => setDeletedNoteWithoutReceipt(null)}
            >
              <X className="icon-sm" />
            </Button>
          </span>
        </div>
      )}
    </>
  );
}
