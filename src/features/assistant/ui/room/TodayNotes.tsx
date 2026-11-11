import type { AssistantSnapshot } from "../../../../shared/model/host-contracts/assistant";
import { t } from "../../../../shared/i18n";
import { Button } from "../../../../shared/ui/Button";
import { SectionLabel } from "../../../../shared/ui/SectionLabel";
import { Tooltip } from "../../../../shared/ui/Tooltip";
import { todayNoteLines, type TodayNoteLine } from "./todayNotesLines";
import styles from "./TodayTab.module.css";

/** Lines grouped under their note's title; a line without a title continues the previous group. */
function groupLines(lines: TodayNoteLine[]) {
  const groups: { key: string; title: string; rows: TodayNoteLine[] }[] = [];
  for (const line of lines) {
    const last = groups[groups.length - 1];
    if (line.title || !last) groups.push({ key: line.key, title: line.title, rows: [line] });
    else last.rows.push(line);
  }
  return groups;
}

/** Today's notes as at most three lines under their note title, linking to the Notes tab. Renders nothing when there are none. */
export function TodayNotes({
  snapshot,
  onOpenNotes,
}: {
  snapshot: AssistantSnapshot;
  onOpenNotes: () => void;
}) {
  const dayStart = new Date().setHours(0, 0, 0, 0);
  const notes = snapshot.notes
    .filter((note) => note.updatedAt >= dayStart)
    .sort((left, right) => right.updatedAt - left.updatedAt);
  if (!notes.length) return null;
  return (
    <section className={styles.notes} aria-label={t("Today's notes")}>
      <SectionLabel
        as="h2"
        actions={
          <Button variant="link" onClick={onOpenNotes}>
            {t("Open notes")}
          </Button>
        }
      >
        {t("Today's notes")}
      </SectionLabel>
      {groupLines(todayNoteLines(notes)).map((group) => (
        <div key={group.key} className={styles.noteGroup}>
          {group.title && (
            <SectionLabel as="h3" className={styles.noteTitle}>
              {group.title}
            </SectionLabel>
          )}
          <ul className={styles.noteList}>
            {group.rows.map((row) => (
              <li key={row.key} className={styles.note} data-timed={row.time ? "" : undefined}>
                {row.time && <span className={styles.noteTime}>{row.time}</span>}
                {row.text && (
                  <Tooltip asChild label={row.text} when="overflow">
                    <span className={styles.noteText}>{row.text}</span>
                  </Tooltip>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
