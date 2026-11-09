import type { AssistantNote } from "../../../../shared/model/host-contracts/assistant";
import { t } from "../../../../shared/i18n";
import { Badge } from "../../../../shared/ui/Badge";
import { Button } from "../../../../shared/ui/Button";
import { Timestamp } from "../../../../shared/ui/Timestamp";
import { dailyNoteDay, notePreview } from "./assistantNoteDisplay";
import styles from "./NotesTab.module.css";

/** Selectable note rows: title, age, one-line preview and a Daily badge. No controls inside a row. */
export function NotesList({
  notes,
  selectedId,
  onSelect,
}: {
  notes: readonly AssistantNote[];
  selectedId: string | undefined;
  onSelect: (id: string) => void;
}) {
  return (
    <ul className={styles.list} aria-label={t("Notes")}>
      {notes.map((note) => {
        const preview = notePreview(note.body);
        return (
          <li key={note.id}>
            <Button
              variant="item"
              selected={note.id === selectedId}
              aria-current={note.id === selectedId ? "true" : undefined}
              onClick={() => onSelect(note.id)}
            >
              <span className={styles.row}>
                <span className={styles.rowTop}>
                  <span className={styles.rowTitle}>{note.title}</span>
                  <Timestamp
                    className={styles.rowTime}
                    value={note.updatedAt}
                    format="relative"
                    relativeStyle="narrow"
                  />
                </span>
                {preview && <span className={styles.rowPreview}>{preview}</span>}
                {dailyNoteDay(note) !== undefined && <Badge size="xs">{t("Daily")}</Badge>}
              </span>
            </Button>
          </li>
        );
      })}
    </ul>
  );
}
