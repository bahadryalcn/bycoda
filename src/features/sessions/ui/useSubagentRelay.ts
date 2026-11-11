import { useRef, useState } from "react";
import { subagentRelayPrompt } from "../model/subagentRelay";
import type { Block, ComposerTurnOptions } from "../model/session";

type Entry = { draft: string; status?: "accepted" | "rejected" };
const EMPTY: Entry = { draft: "" };

// Module-level so the try/finally stays out of the hook the React Compiler compiles.
function submitRelay({
  draft,
  prompt,
  submitting,
  onSubmit,
  read,
  write,
}: {
  draft: string;
  prompt: string;
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
        current.draft && current.draft !== draft
          ? `${current.draft}

${draft}`
          : draft,
      status: "rejected",
    });
    return true;
  };
  try {
    const accepted = onSubmit(prompt, { onSendRejected: recover });
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

/** Kept in the pane so closing or swapping sheets preserves each agent's draft. */
export function useSubagentRelay({
  sessionId,
  block,
  blocked,
  onSubmit,
}: {
  sessionId: string;
  block?: Block;
  blocked: boolean;
  onSubmit: (text: string, options: ComposerTurnOptions) => boolean | void;
}) {
  const [entries, setEntries] = useState<Record<string, Entry>>({});
  const entriesRef = useRef(entries);
  const submitting = useRef(false);
  const key = JSON.stringify([sessionId, block?.id]);
  const entry = entries[key] ?? EMPTY;
  const update = (target: string, value: Entry) => {
    entriesRef.current = { ...entriesRef.current, [target]: value };
    setEntries(entriesRef.current);
  };
  const send = () => {
    if (blocked || !block || submitting.current) return;
    const draft = (entriesRef.current[key] ?? EMPTY).draft;
    const prompt = subagentRelayPrompt(block, draft);
    if (!prompt) return;
    submitting.current = true;
    submitRelay({
      draft,
      prompt,
      submitting,
      onSubmit,
      read: () => entriesRef.current[key] ?? EMPTY,
      write: (value) => update(key, value),
    });
  };
  return {
    ...entry,
    setDraft: (draft: string) => update(key, { draft }),
    send,
  };
}
