import { useState } from "react";
import { Button } from "../../../shared/ui/Button";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { Modal, ModalActions } from "../../../shared/ui/Modal";
import { TextField } from "../../../shared/ui/TextField";
import { Plus, Trash2 } from "../../../shared/ui/icons";
import { confirmInApp } from "../../../shared/model/appConfirm";
import { t, useLocale } from "../../../shared/i18n";
import {
  MEMORY_LIMITS,
  forgetVoiceNote,
  loadVoiceMemory,
  rememberVoiceNote,
  saveVoiceMemory,
  useVoiceMemory,
} from "../model/voiceMemory";
import styles from "./VoiceMemoryDialog.module.css";

/** Shows what the companion remembers on this device; notes can be added or removed. */
export function VoiceMemoryDialog({ onClose }: { onClose: () => void }) {
  useLocale();
  const memory = useVoiceMemory();
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const add = () => {
    const result = rememberVoiceNote(draft);
    if (result.saved) {
      setDraft("");
      setError("");
    } else setError(t(result.error));
  };
  const forgetAll = async () => {
    const ok = await confirmInApp({
      title: t("Forget all notes?"),
      message: t("The voice companion will no longer remember these {p0} notes.", {
        p0: memory.notes.length,
      }),
      confirmLabel: t("Forget all"),
      tone: "danger",
    });
    if (ok) saveVoiceMemory({ ...loadVoiceMemory(), notes: [] });
  };
  return (
    <Modal
      title={t("Companion memory")}
      description={t(
        "Short notes the companion keeps between conversations. Ask it to remember or forget something, or edit the list here.",
      )}
      size="md"
      onClose={onClose}
      footer={
        <ModalActions
          start={
            memory.notes.length ? (
              <Button variant="ghost" onClick={() => void forgetAll()}>
                {t("Forget all")}
              </Button>
            ) : undefined
          }
        >
          <Button variant="primary" onClick={onClose}>
            {t("Done")}
          </Button>
        </ModalActions>
      }
    >
      <div className={styles.body}>
        <form
          className={styles.add}
          onSubmit={(event) => {
            event.preventDefault();
            add();
          }}
        >
          <TextField
            label={t("New note")}
            hideLabel
            value={draft}
            placeholder={t("e.g. I prefer short answers in the morning")}
            maxLength={MEMORY_LIMITS.text}
            disabled={!memory.enabled}
            error={error || undefined}
            onChange={(event) => {
              setDraft(event.target.value);
              setError("");
            }}
          />
          <Button type="submit" disabled={!memory.enabled || !draft.trim()}>
            <Plus aria-hidden className="icon-sm" />
            {t("Add")}
          </Button>
        </form>
        {memory.notes.length ? (
          <ul className={styles.list} aria-label={t("Saved notes")}>
            {[...memory.notes].reverse().map((note) => (
              <li className={styles.note} key={note.id}>
                <span className={styles.text}>{note.text}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  iconOnly
                  label={t("Forget note")}
                  tooltip={t("Forget note")}
                  onClick={() => forgetVoiceNote(note.id)}
                >
                  <Trash2 aria-hidden className="icon-sm" />
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            title={t("Nothing remembered yet")}
            description={t("Say “remember that…” while talking, or add a note above.")}
          />
        )}
      </div>
    </Modal>
  );
}
