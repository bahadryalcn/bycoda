import { Text } from "../../../../shared/ui/Text";
import type { AssistantNote } from "../../../../shared/model/host-contracts/assistant";
import { t } from "../../../../shared/i18n";
import { Button } from "../../../../shared/ui/Button";
import { Heading } from "../../../../shared/ui/Heading";
import { Timestamp } from "../../../../shared/ui/Timestamp";
import { Trash2 } from "../../../../shared/ui/icons";
import { AgentMarkdown } from "../../../sessions/public/AgentMarkdown";
import { stripAssistantEventMarkers } from "../../model/assistantEventMarkers";
import { dailyNoteDay, noteLines } from "./assistantNoteDisplay";
import styles from "./NotesTab.module.css";

/** Reads one note. Mutation identity, confirmation and recovery stay with the Room callbacks. */
export function NotesReader({
  note,
  onEdit,
  onDelete,
}: {
  note: AssistantNote;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const daily = dailyNoteDay(note) !== undefined;
  const lines = noteLines(note.body);
  return (
    <article className={styles.reader} aria-label={note.title}>
      <header className={styles.readerHeader}>
        <div className={styles.readerTitle}>
          <Heading size="section" level={3}>
            {note.title}
          </Heading>
          <Timestamp
            className={styles.readerMeta}
            size="caption"
            tone="muted"
            leading="inherit"
            value={note.updatedAt}
            prefix={t("Updated")}
          />
        </div>
        <div className={styles.readerActions}>
          <Button variant="secondary" onClick={onEdit}>
            {t("Edit")}
          </Button>
          <Button iconOnly variant="ghost" label={t("Delete note")} onClick={onDelete}>
            <Trash2 className="icon-sm" />
          </Button>
        </div>
      </header>
      {daily ? (
        <>
          <Text
            as="ol"
            size="secondary"
            tone="inherit"
            leading="normal"
            className={styles.timeline}
          >
            {lines.map((line, index) => (
              <li key={index} className={styles.entry}>
                <Text size="caption" tone="muted" leading="inherit" className={styles.entryTime}>
                  {line.time ?? ""}
                </Text>
                <span>{line.text}</span>
              </li>
            ))}
          </Text>
          {lines.some((line) => line.time) && (
            <Text as="p" tone="muted" leading="inherit" className={styles.readerMeta}>
              {t("Times are in UTC.")}
            </Text>
          )}
        </>
      ) : (
        lines.length > 0 && (
          <Text
            as="div"
            size="secondary"
            tone="primary"
            leading="relaxed"
            className={styles.markdown}
          >
            <AgentMarkdown text={stripAssistantEventMarkers(note.body)} hardBreaks />
          </Text>
        )
      )}
    </article>
  );
}
