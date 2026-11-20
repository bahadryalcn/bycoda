import { useRef, useState } from "react";
import { getComposerDraft } from "../model/draftCache";

type DraftAuthority = {
  sessionId: string;
  /** The cache held an entry (even an empty one) when mounted, or the user has edited since. */
  present: boolean;
  /** Restored text offered to the composer once; undefined after the first local edit. */
  initialDraft: string | undefined;
  /** Text restored for this session; the baseline until the first local edit. */
  seed: string | undefined;
};

function authorityOf(sessionId: string): DraftAuthority {
  const restored = getComposerDraft(sessionId);
  return { sessionId, present: restored !== undefined, initialDraft: restored, seed: restored };
}

/**
 * Parent-side authority over one session's composer draft, without echoing local
 * edits back into the parent render. Typing only flips `present`/`initialDraft`
 * once (restored seed -> consumed); every later keystroke bails out, so the pane
 * stays idle while the composer owns the text. The latest text is read through
 * `text()`, never from render state. Another session starts from its own cache.
 */
export function useSessionComposerDraft(sessionId: string) {
  const [state, setState] = useState(() => authorityOf(sessionId));
  const latest = useRef<{ sessionId: string; text: string } | null>(null);
  let current = state;
  if (state.sessionId !== sessionId) {
    // A reused pane must not offer the previous session's seed or presence.
    current = authorityOf(sessionId);
    setState(current);
  }
  return {
    present: current.present,
    initialDraft: current.initialDraft,
    /** Latest unsent text the composer published for this session (read on demand). */
    text: (): string | undefined =>
      latest.current?.sessionId === sessionId ? latest.current.text : current.seed,
    change(value: string) {
      latest.current = { sessionId, text: value };
      setState((previous) =>
        previous.sessionId === sessionId && previous.present && previous.initialDraft === undefined
          ? previous
          : {
              sessionId,
              present: true,
              initialDraft: undefined,
              seed: previous.sessionId === sessionId ? previous.seed : getComposerDraft(sessionId),
            },
      );
    },
  };
}
