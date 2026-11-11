import { useState } from "react";
import type {
  AssistantNote,
  AssistantSnapshot,
} from "../../../../shared/model/host-contracts/assistant";
import { formatDate, t } from "../../../../shared/i18n";
import { Button } from "../../../../shared/ui/Button";
import { Heading } from "../../../../shared/ui/Heading";
import { Surface } from "../../../../shared/ui/Surface";
import { Checkbox } from "../../../../shared/ui/Checkbox";
import { deleteNotesInOrder } from "./noteBulkDelete";
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
    pending,
    errorFor,
    empty,
  } = room;

  const [selectedId, setSelectedId] = useState<string>();
  const visible = sortNotesForDisplay(snapshot.notes).filter((note) =>
    matches(query, note.title, note.body),
  );
  // The selection follows search and deletion: a missing id falls back to the first visible note.
  const selected = visible.find((note) => note.id === selectedId) ?? visible[0];
  // Checked notes are those still visible; search or deletion silently drops the rest.
  const [checkedIds, setCheckedIds] = useState<ReadonlySet<string>>(new Set());
  const checkedNotes = visible.filter((note) => checkedIds.has(note.id));
  const checked = new Set(checkedNotes.map((note) => note.id));
  const allChecked = checkedNotes.length > 0 && checkedNotes.length === visible.length;
  const setChecked = (id: string, value: boolean) => {
    const next = new Set(checked);
    if (value) next.add(id);
    else next.delete(id);
    setCheckedIds(next);
  };
  const confirmBulkDelete = (notes: AssistantNote[]) =>
    setConfirm({
      title: t("Delete {p0} notes?", { p0: notes.length }),
      message: t("You can restore these notes from Recently deleted for seven days."),
      confirmLabel: t("Delete"),
      onConfirm: async () => {
        const outcome = await deleteNotesInOrder(notes, (note) =>
          assistantRequest({ op: "notes.delete", id: note.id, expectedUpdatedAt: note.updatedAt }),
        );
        // On a failure the remaining notes stay checked; deleted ones drop out on their own.
        if (!outcome.error) setCheckedIds(new Set());
        if (outcome.trashIds.length) {
          setUndo({
            id: outcome.trashIds[0]!,
            ids: outcome.trashIds,
            label: t("{p0} notes", { p0: outcome.trashIds.length }),
            environmentId,
          });
        } else if (outcome.deleted) setUndo(null);
        setDeletedNoteWithoutReceipt(
          outcome.withoutReceipt.length ? outcome.withoutReceipt.join(", ") : null,
        );
        if (outcome.error)
          throw new Error(
            t("{p0} of {p1} notes were deleted. Review the Room before retrying.", {
              p0: outcome.deleted,
              p1: notes.length,
            }),
          );
      },
    });
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
              <Surface variant="card" padding="md" className={styles.summary}>
                {dailySummary.snapshot.briefing && canReadBriefing(dailySummary.snapshot) ? (
                  <>
                    <Heading size="item" level={3}>
                      {t("Daily summary")}
                    </Heading>
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
              </Surface>
            )}
          {!snapshot.capabilities.notes && (
            <p className={styles.unavailable}>{t("Global notes are unavailable on this Host.")}</p>
          )}
          {visible.length > 0 && (
            <div className={styles.layout}>
              <div className={styles.listPane}>
                <div className={styles.listHead}>
                  <Checkbox
                    label={
                      checkedNotes.length
                        ? t("{p0} selected", { p0: checkedNotes.length })
                        : t("Select all")
                    }
                    checked={allChecked}
                    indeterminate={checkedNotes.length > 0 && !allChecked}
                    onChange={(event) =>
                      setCheckedIds(
                        new Set(event.currentTarget.checked ? visible.map((note) => note.id) : []),
                      )
                    }
                  />
                  {checkedNotes.length > 0 && (
                    <>
                      <Button size="sm" variant="ghost" onClick={() => setCheckedIds(new Set())}>
                        {t("Clear selection")}
                      </Button>
                      <Button
                        size="sm"
                        tone="danger"
                        disabled={Boolean(pending)}
                        onClick={() => confirmBulkDelete(checkedNotes)}
                      >
                        {t("Delete")}
                      </Button>
                    </>
                  )}
                </div>
                <NotesList
                  notes={visible}
                  selectedId={selected?.id}
                  onSelect={setSelectedId}
                  checked={checked}
                  onCheck={setChecked}
                />
              </div>
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
