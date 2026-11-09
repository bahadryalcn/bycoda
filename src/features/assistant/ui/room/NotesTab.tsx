import { useState } from "react";
import type {
  AssistantNote,
  AssistantSnapshot,
} from "../../../../shared/model/host-contracts/assistant";
import { formatDate, t } from "../../../../shared/i18n";
import { matches } from "./assistantRoomHelpers";
import { sortNotesForDisplay } from "./assistantNoteDisplay";
import { useAssistantRoom } from "./assistantRoomContext";
import { NotesList } from "./NotesList";
import { NotesReader } from "./NotesReader";
import styles from "./NotesTab.module.css";

export function NotesTab({ snapshot }: { snapshot: AssistantSnapshot }) {
  const room = useAssistantRoom();
  const {
    environmentId,
    assistantRequest,
    privacy,
    canReadBriefing,
    view,
    query,
    dailySummary,
    setConfirm,
    setUndo,
    setDeletedNoteWithoutReceipt,
    setNoteEdit,
    errorFor,
    empty,
  } = room;

  const [selectedId, setSelectedId] = useState<string>();
  const visible = sortNotesForDisplay(snapshot.notes).filter((note) =>
    matches(query, note.title, note.body),
  );
  // The selection follows search and deletion: a missing id falls back to the first visible note.
  const selected = visible.find((note) => note.id === selectedId) ?? visible[0];
  const confirmDelete = (note: AssistantNote) =>
    setConfirm({
      title: t("Delete note?"),
      message: note.title,
      confirmLabel: t("Delete"),
      onConfirm: async () => {
        const result = await assistantRequest({
          op: "notes.delete",
          id: note.id,
          expectedUpdatedAt: note.updatedAt,
        });
        if (result.ok !== true)
          throw new Error(t("Note deletion is uncertain. Review the Room before retrying."));
        if (result.trashId?.startsWith("notetrash:")) {
          setDeletedNoteWithoutReceipt(null);
          setUndo({ id: result.trashId, label: note.title, environmentId });
        } else {
          setUndo(null);
          setDeletedNoteWithoutReceipt(note.title);
        }
      },
    });

  return (
    <>
      {view === "Notes" && (
        <section>
          {errorFor("notes.summary")}
          {dailySummary &&
            dailySummary.environmentId === environmentId &&
            dailySummary.scopeKey === privacy.key && (
              <div className={styles.summary}>
                {dailySummary.snapshot.briefing && canReadBriefing(dailySummary.snapshot) ? (
                  <>
                    <h3>{t("Daily summary")}</h3>
                    <p className={styles.summaryMeta}>
                      {t("Saved daily summary · {p0}", {
                        p0: formatDate(dailySummary.snapshot.briefing.createdAt, {
                          dateStyle: "medium",
                          timeStyle: "short",
                        }),
                      })}
                    </p>
                    <p>{dailySummary.snapshot.briefing.text}</p>
                    <p className={styles.summaryMeta}>
                      {t("Today's summary is reused after it is generated.")}
                    </p>
                  </>
                ) : (
                  <p>{t("Nothing new to report.")}</p>
                )}
              </div>
            )}
          {!snapshot.capabilities.notes && (
            <p className={styles.unavailable}>{t("Global notes are unavailable on this Host.")}</p>
          )}
          {visible.length > 0 && (
            <div className={styles.layout}>
              <NotesList notes={visible} selectedId={selected?.id} onSelect={setSelectedId} />
              {selected && (
                <NotesReader
                  key={selected.id}
                  note={selected}
                  onEdit={() => setNoteEdit(selected)}
                  onDelete={() => confirmDelete(selected)}
                />
              )}
            </div>
          )}
          {snapshot.capabilities.notes &&
            visible.length === 0 &&
            empty(query ? "No results" : "No notes yet")}
        </section>
      )}
    </>
  );
}
