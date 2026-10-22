import { useRef, useState } from "react";
import { subagentRelayPrompt } from "../model/subagentRelay";
import type { Block, ComposerTurnOptions } from "../model/session";

type Entry = { draft: string; status?: "accepted" | "rejected" };
const EMPTY: Entry = { draft: "" };

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
    let rejected = false;
    const recover = () => {
      if (rejected) return true;
      rejected = true;
      const current = entriesRef.current[key] ?? EMPTY;
      // A late rejection must not overwrite a newer draft.
      update(key, {
        draft: current.draft && current.draft !== draft ? `${current.draft}\n\n${draft}` : draft,
        status: "rejected",
      });
      return true;
    };
    try {
      const accepted = onSubmit(prompt, { onSendRejected: recover });
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
    setDraft: (draft: string) => update(key, { draft }),
    send,
  };
}
