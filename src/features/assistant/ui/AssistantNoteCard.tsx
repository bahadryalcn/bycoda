import type { ReactNode } from "react";
import type { AssistantNote } from "../../../shared/model/host-contracts/assistant";
import { Button } from "../../../shared/ui/Button";
import styles from "./AssistantNoteCard.module.css";

/** Presentation only: Room keeps mutation identity, confirmation and recovery. */
export function AssistantNoteCard({
  note,
  updatedAt,
  onOpen,
  actions,
}: {
  note: AssistantNote;
  updatedAt: string;
  onOpen: () => void;
  actions: ReactNode;
}) {
  return (
    <article className={styles.card}>
      <div className={styles.heading}>
        <h3>
          <Button variant="link" onClick={onOpen}>
            {note.title}
          </Button>
        </h3>
        <div className={styles.actions}>{actions}</div>
      </div>
      <time className={styles.date} dateTime={new Date(note.updatedAt).toISOString()}>
        {updatedAt}
      </time>
      {note.body && <p className={styles.excerpt}>{note.body}</p>}
    </article>
  );
}
