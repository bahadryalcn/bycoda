import { EmptyState } from "../../../../shared/ui/EmptyState";
import { t } from "../../../../shared/i18n";
import { Button } from "../../../../shared/ui/Button";
import { Text } from "../../../../shared/ui/Text";
import { surfaceAttributes } from "../../../../shared/ui/Surface";
import type {
  AssistantJob,
  AssistantNote,
} from "../../../../shared/model/host-contracts/assistant";
import { stripAssistantEventMarkers } from "../../model/assistantEventMarkers";
import { AgentMarkdown } from "../../../sessions/public/AgentMarkdown";
import styles from "./Jobs.module.css";

/** Note lines that mention this job by its id or title. */
export function jobNoteHits(job: AssistantJob, notes: readonly AssistantNote[]) {
  const needles = [job.id, job.title.trim()]
    .filter((value) => value.length > 0)
    .map((value) => value.toLocaleLowerCase());
  return notes
    .map((note) => ({
      note,
      lines: stripAssistantEventMarkers(note.body)
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => {
          const lower = line.toLocaleLowerCase();
          return line && needles.some((needle) => lower.includes(needle));
        }),
    }))
    .filter((hit) => hit.lines.length > 0);
}

export function JobDetailNotes({
  job,
  notes,
  onOpenNote,
}: {
  job: AssistantJob;
  notes: readonly AssistantNote[];
  onOpenNote: (note: AssistantNote) => void;
}) {
  const hits = jobNoteHits(job, notes);
  if (!hits.length)
    return (
      <EmptyState
        size="inline"
        kind="empty"
        className={styles.muted}
        description={t("No notes mention this job yet.")}
      />
    );
  return (
    <div {...surfaceAttributes({ dividers: "pane" }, styles.block)}>
      {hits.map(({ note, lines }) => (
        <Text
          as="section"
          key={note.id}
          tone="inherit"
          leading="inherit"
          className={styles.noteHit}
        >
          <Button variant="link" onClick={() => onOpenNote(note)}>
            {note.title}
          </Button>
          <AgentMarkdown text={lines.join("\n\n")} />
        </Text>
      ))}
    </div>
  );
}
