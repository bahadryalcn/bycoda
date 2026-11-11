import { useRef, useState } from "react";
import type { ComposerTurnOptions } from "../model/session";

type Entry = { draft: string; status?: "accepted" | "rejected" };
const EMPTY: Entry = { draft: "" };

// Module-level so the try/finally stays out of the hook the React Compiler compiles.
function submitDelegated({
  text,
  submitting,
  onSubmit,
  read,
  write,
}: {
  text: string;
  submitting: { current: boolean };
  onSubmit: (text: string, options: ComposerTurnOptions) => boolean | void;
  read: () => Entry;
  write: (value: Entry) => void;
}) {
  let rejected = false;
  const recover = () => {
    if (rejected) return true;
    rejected = true;
    const current = read();
    // A late rejection must not overwrite a newer draft.
    write({
      draft:
        current.draft && current.draft !== text
          ? `${current.draft}

${text}`
          : text,
      status: "rejected",
    });
    return true;
  };
  try {
    const accepted = onSubmit(text, { onSendRejected: recover });
    if (accepted === false) {
      if (!rejected) recover();
    } else if (!rejected) {
      write({ draft: "", status: "accepted" });
    }
  } catch {
    if (!rejected) recover();
  } finally {
    submitting.current = false;
  }
}

/**
 * The message box of a delegated child. It sends straight to the child session:
 * the submit path steers it while it runs and starts a new turn once it is idle.
 * Kept by the caller (always mounted) so each child's draft survives closing the sheet.
 */
export function useDelegatedMessage({
  childSessionId,
  blocked,
  onSubmit,
}: {
  childSessionId?: string;
  blocked: boolean;
  onSubmit: (text: string, options: ComposerTurnOptions) => boolean | void;
}) {
  const [entries, setEntries] = useState<Record<string, Entry>>({});
  const entriesRef = useRef(entries);
  const submitting = useRef(false);
  const key = childSessionId ?? "";
  const entry = entries[key] ?? EMPTY;
  const update = (target: string, value: Entry) => {
    entriesRef.current = { ...entriesRef.current, [target]: value };
    setEntries(entriesRef.current);
  };
  const send = () => {
    if (blocked || !childSessionId || submitting.current) return;
    const text = (entriesRef.current[key] ?? EMPTY).draft.trim();
    if (!text) return;
    submitting.current = true;
    submitDelegated({
      text,
      submitting,
      onSubmit,
      read: () => entriesRef.current[key] ?? EMPTY,
      write: (value) => update(key, value),
    });
  };
  return {
    ...entry,
    setDraft: (draft: string) => update(key, { ...(entriesRef.current[key] ?? EMPTY), draft }),
    send,
  };
}
