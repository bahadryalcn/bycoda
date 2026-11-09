import { useRef, useState } from "react";
import type { ComposerTurnOptions } from "../model/session";

type Entry = { draft: string; status?: "accepted" | "rejected" };
const EMPTY: Entry = { draft: "" };

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
    let rejected = false;
    const recover = () => {
      if (rejected) return true;
      rejected = true;
      const current = entriesRef.current[key] ?? EMPTY;
      // A late rejection must not overwrite a newer draft.
      update(key, {
        draft: current.draft && current.draft !== text ? `${current.draft}\n\n${text}` : text,
        status: "rejected",
      });
      return true;
    };
    try {
      const accepted = onSubmit(text, { onSendRejected: recover });
      if (accepted === false) {
        if (!rejected) recover();
      } else if (!rejected) {
        update(key, { draft: "", status: "accepted" });
      }
    } catch {
      if (!rejected) recover();
    } finally {
      submitting.current = false;
    }
  };
  return {
    ...entry,
    setDraft: (draft: string) => update(key, { ...(entriesRef.current[key] ?? EMPTY), draft }),
    send,
  };
}
