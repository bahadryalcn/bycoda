import { Text } from "../../../../shared/ui/Text";
import type { AssistantNote } from "../../../../shared/model/host-contracts/assistant";
import { t } from "../../../../shared/i18n";
import { ActionHost } from "../../../../shared/ui/ActionHost";
import { Badge } from "../../../../shared/ui/Badge";
import { Button } from "../../../../shared/ui/Button";
import { Checkbox } from "../../../../shared/ui/Checkbox";
import { Timestamp } from "../../../../shared/ui/Timestamp";
import { motionAttributes } from "../../../../shared/ui/Motion";
import { dailyNoteDay, notePreview } from "./assistantNoteDisplay";
import styles from "./NotesTab.module.css";

/**
 * Note rows: a selection checkbox (revealed on hover, focus or while any note is checked)
 * and the open-note button with title, age, one-line preview and a Daily badge.
 */
export function NotesList({
  notes,
  selectedId,
  onSelect,
  checked,
  onCheck,
}: {
  notes: readonly AssistantNote[];
  selectedId: string | undefined;
  onSelect: (id: string) => void;
  checked: ReadonlySet<string>;
  onCheck: (id: string, checked: boolean) => void;
}) {
  const selectionMode = checked.size > 0;
  return (
    <ul className={styles.list} aria-label={t("Notes")}>
      {notes.map((note) => {
        const preview = notePreview(note.body);
        const isChecked = checked.has(note.id);
        return (
          <ActionHost
            as="li"
            key={note.id}
            className={styles.item}
            selected={note.id === selectedId || isChecked}
          >
            <Checkbox
              {...motionAttributes({ transition: "opacity", easing: "standard" }, styles.check)}
              data-action-inline=""
              data-visible={selectionMode || undefined}
              aria-label={t("Select {p0}", { p0: note.title })}
              checked={isChecked}
              onChange={(event) => onCheck(note.id, event.currentTarget.checked)}
            />
            <Button
              variant="item"
              aria-current={note.id === selectedId ? "true" : undefined}
              onClick={() => onSelect(note.id)}
            >
              <span className={styles.row}>
                <span className={styles.rowTop}>
                  <Text
                    as="span"
                    size="body"
                    tone="inherit"
                    weight="medium"
                    leading="inherit"
                    truncate
                    className={styles.rowTitle}
                  >
                    {note.title}
                  </Text>
                  <Timestamp
                    className={styles.rowTime}
                    size="micro"
                    tone="muted"
                    leading="inherit"
                    value={note.updatedAt}
                    format="relative"
                    relativeStyle="narrow"
                  />
                </span>
                {preview && (
                  <Text
                    size="caption"
                    tone="secondary"
                    leading="inherit"
                    weight="regular"
                    truncate
                    className={styles.rowPreview}
                  >
                    {preview}
                  </Text>
                )}
                {dailyNoteDay(note) !== undefined && <Badge size="xs">{t("Daily")}</Badge>}
              </span>
            </Button>
          </ActionHost>
        );
      })}
    </ul>
  );
}
