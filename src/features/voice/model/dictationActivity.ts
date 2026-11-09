import { useSyncExternalStore } from "react";
import type { DictationState } from "./dictation";

/** A dictation run that holds the microphone, as its composer button reports it. */
export type ActiveDictation = {
  /** Session whose message box receives the text; absent outside a session. */
  sessionId?: string;
  state: Exclude<DictationState, "idle">;
  /** Whether its composer button is on screen. A hidden one still listens. */
  visible: boolean;
  /** Stops the microphone and finishes what was already said. */
  stop: () => void;
};

const runs = new Map<symbol, ActiveDictation>();
const listeners = new Set<() => void>();
let snapshot: readonly ActiveDictation[] = [];

/** Reports or clears (`undefined`) one dictation run; same-window only. */
export function reportDictation(owner: symbol, run: ActiveDictation | undefined) {
  if (run) runs.set(owner, run);
  else if (!runs.delete(owner)) return;
  snapshot = [...runs.values()];
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Dictation runs that hold the microphone in this window. */
export function useActiveDictations(): readonly ActiveDictation[] {
  return useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => snapshot,
  );
}
